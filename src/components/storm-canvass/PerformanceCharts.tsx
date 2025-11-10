import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface DailyActivityData {
  date: string;
  doors: number;
  leads: number;
  photos: number;
}

interface DispositionData {
  name: string;
  value: number;
  fill: string;
}

interface PerformanceChartsProps {
  dailyActivityData: DailyActivityData[];
  dispositionBreakdown: DispositionData[];
}

export function PerformanceCharts({ dailyActivityData, dispositionBreakdown }: PerformanceChartsProps) {
  const totalContacts = dispositionBreakdown.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Daily Activity Line Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Activity Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyActivityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dailyActivityData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  className="text-xs"
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis 
                  className="text-xs"
                  stroke="hsl(var(--muted-foreground))"
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                  }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="doors" 
                  name="Doors Knocked"
                  stroke="hsl(var(--chart-1))" 
                  strokeWidth={2}
                  dot={{ fill: 'hsl(var(--chart-1))' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="leads" 
                  name="Leads Generated"
                  stroke="hsl(var(--chart-2))" 
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ fill: 'hsl(var(--chart-2))' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="photos" 
                  name="Photos Uploaded"
                  stroke="hsl(var(--chart-3))" 
                  strokeWidth={2}
                  strokeDasharray="3 3"
                  dot={{ fill: 'hsl(var(--chart-3))' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No activity data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disposition Breakdown Pie Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Disposition Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {dispositionBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={dispositionBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="hsl(var(--primary))"
                  dataKey="value"
                >
                  {dispositionBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '6px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No disposition data available
            </div>
          )}
          {totalContacts > 0 && (
            <div className="text-center mt-4">
              <p className="text-2xl font-bold text-foreground">{totalContacts}</p>
              <p className="text-sm text-muted-foreground">Total Contacts</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
