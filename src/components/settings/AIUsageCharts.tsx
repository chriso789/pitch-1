import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

interface TimeSeriesData {
  hour: string;
  provider: string;
  request_count: number;
  total_tokens: number;
  avg_response_time_ms: number;
  total_cost_usd: number;
  success_count: number;
  error_count: number;
}

interface AIUsageChartsProps {
  timeSeries: TimeSeriesData[];
}

export const AIUsageCharts = ({ timeSeries }: AIUsageChartsProps) => {
  // Aggregate data by hour for charts
  const chartData = timeSeries.reduce((acc, curr) => {
    const hour = format(new Date(curr.hour), 'MMM dd HH:mm');
    const existing = acc.find(item => item.hour === hour);
    
    if (existing) {
      existing[`${curr.provider}_requests`] = curr.request_count;
      existing[`${curr.provider}_tokens`] = curr.total_tokens;
      existing[`${curr.provider}_cost`] = curr.total_cost_usd;
      existing[`${curr.provider}_response_time`] = curr.avg_response_time_ms;
      existing.total_requests += curr.request_count;
    } else {
      acc.push({
        hour,
        [`${curr.provider}_requests`]: curr.request_count,
        [`${curr.provider}_tokens`]: curr.total_tokens,
        [`${curr.provider}_cost`]: curr.total_cost_usd,
        [`${curr.provider}_response_time`]: curr.avg_response_time_ms,
        total_requests: curr.request_count,
      });
    }
    return acc;
  }, [] as any[]);

  return (
    <div className="grid gap-6">
      {/* Requests Over Time */}
      <Card>
        <CardHeader>
          <CardTitle>Requests Over Time</CardTitle>
          <CardDescription>API requests by provider</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="hour" 
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="claude_requests" 
                stroke="hsl(var(--primary))" 
                name="Claude"
                strokeWidth={2}
              />
              <Line 
                type="monotone" 
                dataKey="openai_requests" 
                stroke="hsl(var(--secondary))" 
                name="OpenAI"
                strokeWidth={2}
              />
              <Line 
                type="monotone" 
                dataKey="lovable-ai_requests" 
                stroke="hsl(var(--accent))" 
                name="Lovable AI"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Token Usage */}
      <Card>
        <CardHeader>
          <CardTitle>Token Consumption</CardTitle>
          <CardDescription>Tokens used per hour by provider</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="hour" 
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="claude_tokens" fill="hsl(var(--primary))" name="Claude" />
              <Bar dataKey="openai_tokens" fill="hsl(var(--secondary))" name="OpenAI" />
              <Bar dataKey="lovable-ai_tokens" fill="hsl(var(--accent))" name="Lovable AI" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Response Time */}
      <Card>
        <CardHeader>
          <CardTitle>Response Times</CardTitle>
          <CardDescription>Average response time in milliseconds</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="hour" 
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="claude_response_time" 
                stroke="hsl(var(--primary))" 
                name="Claude"
                strokeWidth={2}
              />
              <Line 
                type="monotone" 
                dataKey="openai_response_time" 
                stroke="hsl(var(--secondary))" 
                name="OpenAI"
                strokeWidth={2}
              />
              <Line 
                type="monotone" 
                dataKey="lovable-ai_response_time" 
                stroke="hsl(var(--accent))" 
                name="Lovable AI"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Cost Over Time */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Analysis</CardTitle>
          <CardDescription>Estimated costs per hour (USD)</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="hour" 
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis />
              <Tooltip 
                formatter={(value: number) => 
                  new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 4
                  }).format(value)
                }
              />
              <Legend />
              <Bar dataKey="claude_cost" fill="hsl(var(--primary))" name="Claude" stackId="a" />
              <Bar dataKey="openai_cost" fill="hsl(var(--secondary))" name="OpenAI" stackId="a" />
              <Bar dataKey="lovable-ai_cost" fill="hsl(var(--accent))" name="Lovable AI" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};
