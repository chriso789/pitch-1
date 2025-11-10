import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DoorOpen, UserPlus, Camera, MapPin, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";

interface Activity {
  id: string;
  activity_type: string;
  created_at: string;
  latitude?: number;
  longitude?: number;
  contact?: {
    id: string;
    first_name: string;
    last_name: string;
    address_street?: string;
  };
  user?: {
    first_name: string;
    last_name: string;
  };
}

interface ActivityFeedProps {
  activities: Activity[];
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  const navigate = useNavigate();

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'door_knock':
        return <DoorOpen className="h-4 w-4 text-primary" />;
      case 'lead_created':
        return <UserPlus className="h-4 w-4 text-chart-2" />;
      case 'photo_upload':
        return <Camera className="h-4 w-4 text-chart-3" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getActivityDescription = (activity: Activity) => {
    const userName = activity.user 
      ? `${activity.user.first_name} ${activity.user.last_name}`
      : 'Someone';
    
    const address = activity.contact?.address_street || 'a property';
    const contactName = activity.contact 
      ? `${activity.contact.first_name} ${activity.contact.last_name}`
      : '';

    switch (activity.activity_type) {
      case 'door_knock':
        return `${userName} knocked on ${address}`;
      case 'lead_created':
        return `${userName} created lead for ${contactName}`;
      case 'photo_upload':
        return `${userName} uploaded photo at ${address}`;
      default:
        return `${userName} performed activity`;
    }
  };

  const viewOnMap = (lat?: number, lng?: number) => {
    if (lat && lng) {
      navigate(`/storm-canvass/map?lat=${lat}&lng=${lng}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          {activities.length > 0 ? (
            <div className="space-y-3">
              {activities.map((activity) => (
                <div
                  key={activity.id}
                  className="flex gap-3 items-start p-3 hover:bg-muted/50 rounded-lg transition-colors"
                >
                  {/* Icon */}
                  <div className="rounded-full bg-muted p-2 flex-shrink-0">
                    {getActivityIcon(activity.activity_type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 space-y-1 min-w-0">
                    <p className="text-sm leading-relaxed">
                      {getActivityDescription(activity)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                    </p>
                  </div>

                  {/* Actions */}
                  {activity.latitude && activity.longitude && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => viewOnMap(activity.latitude, activity.longitude)}
                      className="flex-shrink-0"
                    >
                      <MapPin className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[200px] text-center">
              <Clock className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No recent activities</p>
              <p className="text-sm text-muted-foreground mt-1">
                Activities will appear here as canvassing begins
              </p>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
