import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Card } from '@/components/ui/card'
import { 
  TrendingUp, TrendingDown, Target, Activity,
  BarChart3, PieChart, Users, Clock
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, PieChart as RePieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

export function MeasurementAnalyticsDashboard() {
  const [metrics, setMetrics] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAnalytics()
  }, [])

  const loadAnalytics = async () => {
    setLoading(true)
    try {
      const { data: performanceData } = await supabase
        .from('roof_ai_model_performance')
        .select('*')
        .order('logged_at', { ascending: false })
        .limit(100)

      const { data: measurementsData } = await supabase
        .from('roof_measurements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      const { data: correctionsData } = await supabase
        .from('roof_measurement_corrections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)

      const calculatedMetrics = calculateMetrics(
        performanceData || [],
        measurementsData || [],
        correctionsData || []
      )

      setMetrics(calculatedMetrics)
    } catch (error) {
      console.error('Error loading analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  const calculateMetrics = (performance: any[], measurements: any[], corrections: any[]) => {
    const avgAccuracy = performance.length > 0
      ? performance.reduce((sum, p) => sum + (p.area_accuracy_percent || 0), 0) / performance.length
      : 0

    const correctionRate = measurements.length > 0
      ? (corrections.length / measurements.length) * 100
      : 0

    const avgProcessingTime = performance.length > 0
      ? performance.reduce((sum, p) => sum + (p.processing_time_seconds || 0), 0) / performance.length
      : 0

    const complexityAccuracy = performance.reduce((acc: any, p) => {
      const complexity = p.roof_complexity || 'unknown'
      if (!acc[complexity]) acc[complexity] = []
      acc[complexity].push(p.area_accuracy_percent || 0)
      return acc
    }, {})

    const accuracyByComplexity = Object.entries(complexityAccuracy).map(([complexity, values]: [string, any]) => ({
      complexity,
      accuracy: values.reduce((sum: number, v: number) => sum + v, 0) / values.length
    }))

    const last30Days = performance.filter(p => {
      const date = new Date(p.logged_at)
      const now = new Date()
      const daysDiff = (now.getTime() - date.getTime()) / (1000 * 3600 * 24)
      return daysDiff <= 30
    })

    const accuracyTrend = last30Days.reduce((acc: any, p) => {
      const date = new Date(p.logged_at).toLocaleDateString()
      if (!acc[date]) acc[date] = []
      acc[date].push(p.area_accuracy_percent || 0)
      return acc
    }, {})

    const trendData = Object.entries(accuracyTrend).map(([date, values]: [string, any]) => ({
      date,
      accuracy: values.reduce((sum: number, v: number) => sum + v, 0) / values.length
    })).slice(-14)

    const correctionTypes = corrections.reduce((acc: any, c) => {
      const type = c.correction_type || 'other'
      acc[type] = (acc[type] || 0) + 1
      return acc
    }, {})

    const correctionTypeData = Object.entries(correctionTypes).map(([type, count]) => ({
      type: type.replace(/_/g, ' '),
      count
    }))

    return {
      summary: {
        avgAccuracy: avgAccuracy.toFixed(1),
        totalMeasurements: measurements.length,
        correctionRate: correctionRate.toFixed(1),
        avgProcessingTime: avgProcessingTime.toFixed(1)
      },
      accuracyByComplexity,
      trendData,
      correctionTypeData
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-foreground"></div>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="text-center p-12 text-muted-foreground">
        No analytics data available
      </div>
    )
  }

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))']

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">AI Measurement Analytics</h1>
        <p className="text-muted-foreground mt-1">Performance metrics and continuous improvement tracking</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Avg Accuracy</p>
              <p className="text-3xl font-bold text-green-600">{metrics.summary.avgAccuracy}%</p>
            </div>
            <Target className="h-12 w-12 text-green-600 opacity-20" />
          </div>
          <div className="mt-2 flex items-center text-sm">
            <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
            <span className="text-green-600">Improving</span>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Measurements</p>
              <p className="text-3xl font-bold text-primary">{metrics.summary.totalMeasurements}</p>
            </div>
            <Activity className="h-12 w-12 text-primary opacity-20" />
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            All time
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Correction Rate</p>
              <p className="text-3xl font-bold text-orange-600">{metrics.summary.correctionRate}%</p>
            </div>
            <Users className="h-12 w-12 text-orange-600 opacity-20" />
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            User corrections
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Avg Processing</p>
              <p className="text-3xl font-bold text-purple-600">{metrics.summary.avgProcessingTime}s</p>
            </div>
            <Clock className="h-12 w-12 text-purple-600 opacity-20" />
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            Per measurement
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <TrendingUp className="mr-2 h-5 w-5 text-primary" />
            Accuracy Trend (Last 14 Days)
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={metrics.trendData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" className="text-muted-foreground" />
              <YAxis domain={[0, 100]} className="text-muted-foreground" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="accuracy" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <BarChart3 className="mr-2 h-5 w-5 text-green-600" />
            Accuracy by Roof Complexity
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metrics.accuracyByComplexity}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="complexity" className="text-muted-foreground" />
              <YAxis domain={[0, 100]} className="text-muted-foreground" />
              <Tooltip />
              <Legend />
              <Bar dataKey="accuracy" fill="hsl(var(--chart-2))" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <PieChart className="mr-2 h-5 w-5 text-orange-600" />
            Correction Types Distribution
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <RePieChart>
              <Pie
                data={metrics.correctionTypeData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => entry.type}
                outerRadius={80}
                fill="hsl(var(--primary))"
                dataKey="count"
              >
                {metrics.correctionTypeData.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </RePieChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Key Insights</h3>
          <div className="space-y-3">
            {parseFloat(metrics.summary.avgAccuracy) >= 90 && (
              <div className="flex items-start gap-3 p-3 bg-green-500/10 border-l-4 border-green-500 rounded">
                <TrendingUp className="h-5 w-5 text-green-600 mt-0.5" />
                <div className="text-sm">
                  <strong className="text-green-900 dark:text-green-400">Excellent Performance</strong>
                  <p className="text-green-700 dark:text-green-500">System is achieving professional-grade accuracy</p>
                </div>
              </div>
            )}
            {parseFloat(metrics.summary.correctionRate) > 20 && (
              <div className="flex items-start gap-3 p-3 bg-orange-500/10 border-l-4 border-orange-500 rounded">
                <TrendingDown className="h-5 w-5 text-orange-600 mt-0.5" />
                <div className="text-sm">
                  <strong className="text-orange-900 dark:text-orange-400">High Correction Rate</strong>
                  <p className="text-orange-700 dark:text-orange-500">Consider reviewing AI prompts or adding more training data</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3 p-3 bg-primary/10 border-l-4 border-primary rounded">
              <Activity className="h-5 w-5 text-primary mt-0.5" />
              <div className="text-sm">
                <strong>Continuous Improvement</strong>
                <p className="text-muted-foreground">Every correction helps train the AI for better future performance</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
