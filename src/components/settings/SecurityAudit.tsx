import { useState, useEffect, createElement } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { 
  Shield, 
  Monitor, 
  Smartphone, 
  Chrome, 
  Laptop, 
  Clock, 
  MapPin, 
  LogOut,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Activity,
  XCircle,
  History
} from 'lucide-react';
import { format } from 'date-fns';

interface SessionInfo {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  isCurrent: boolean;
  userAgent?: string;
  ipAddress?: string;
}

interface ActivityLog {
  id: string;
  user_id: string | null;
  email: string;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  device_info: string | null;
  location_info: string | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

export const SecurityAudit = () => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastLogin, setLastLogin] = useState<string | null>(null);
  const [rememberMeEnabled, setRememberMeEnabled] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadSecurityInfo();
    loadActivityLogs();
    const rememberMe = localStorage.getItem('pitch_remember_me') === 'true';
    setRememberMeEnabled(rememberMe);
  }, []);

  const loadActivityLogs = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      const { data, error } = await supabase
        .from('session_activity_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      setActivityLogs(data || []);
    } catch (error) {
      console.error('Error loading activity logs:', error);
    }
  };

  const loadSecurityInfo = async () => {
    setLoading(true);
    try {
      // Get current session
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      
      if (currentSession) {
        // Parse session info
        const sessionInfo: SessionInfo = {
          id: currentSession.access_token.substring(0, 20) + '...',
          userId: currentSession.user.id,
          createdAt: new Date(currentSession.user.created_at || '').toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: currentSession.expires_at 
            ? new Date(currentSession.expires_at * 1000).toISOString() 
            : new Date(Date.now() + 3600000).toISOString(),
          isCurrent: true,
        };

        setSessions([sessionInfo]);
        
        // Get last login from user metadata
        const lastSignIn = currentSession.user.last_sign_in_at;
        if (lastSignIn) {
          setLastLogin(lastSignIn);
        }
      }
    } catch (error) {
      console.error('Error loading security info:', error);
      toast({
        title: "Error",
        description: "Failed to load security information",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { error } = await supabase.auth.refreshSession();
      if (error) throw error;

      // Log session refresh
      if (user) {
        await supabase.functions.invoke('log-auth-activity', {
          body: {
            user_id: user.id,
            email: user.email || '',
            event_type: 'session_refresh',
            success: true
          }
        }).catch(err => console.error('Failed to log activity:', err));
      }

      toast({
        title: "Session Refreshed",
        description: "Your session has been refreshed successfully",
      });
      
      loadSecurityInfo();
      loadActivityLogs();
    } catch (error) {
      console.error('Error refreshing session:', error);
      toast({
        title: "Error",
        description: "Failed to refresh session",
        variant: "destructive",
      });
    }
  };

  const handleSignOutAllSessions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Log logout activity
        await supabase.functions.invoke('log-auth-activity', {
          body: {
            user_id: user.id,
            email: user.email,
            event_type: 'logout',
            success: true
          }
        }).catch(err => console.error('Failed to log activity:', err));
      }
      
      await supabase.auth.signOut({ scope: 'global' });
      
      toast({
        title: "Signed Out",
        description: "You have been signed out from all devices",
      });
    } catch (error) {
      console.error('Error signing out:', error);
      toast({
        title: "Error",
        description: "Failed to sign out from all devices",
        variant: "destructive",
      });
    }
  };

  const handleRevokeCurrentSession = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Log logout activity
        await supabase.functions.invoke('log-auth-activity', {
          body: {
            user_id: user.id,
            email: user.email,
            event_type: 'logout',
            success: true
          }
        }).catch(err => console.error('Failed to log activity:', err));
      }
      
      await supabase.auth.signOut({ scope: 'local' });
      
      toast({
        title: "Session Ended",
        description: "This session has been terminated",
      });
    } catch (error) {
      console.error('Error revoking session:', error);
      toast({
        title: "Error",
        description: "Failed to revoke session",
        variant: "destructive",
      });
    }
  };

  const getDeviceIcon = (userAgent?: string) => {
    if (!userAgent) return Monitor;
    if (userAgent.toLowerCase().includes('mobile')) return Smartphone;
    if (userAgent.toLowerCase().includes('chrome')) return Chrome;
    return Laptop;
  };

  const getSessionStatus = (expiresAt: string) => {
    const now = Date.now();
    const expires = new Date(expiresAt).getTime();
    const timeLeft = expires - now;
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
    
    if (timeLeft < 0) return { status: 'Expired', variant: 'destructive' as const };
    if (hoursLeft < 1) return { status: 'Expiring Soon', variant: 'secondary' as const };
    return { status: 'Active', variant: 'default' as const };
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Security & Sessions
          </h2>
          <p className="text-muted-foreground mt-1">
            Manage your account security and active sessions
          </p>
        </div>
        <Button onClick={() => { loadSecurityInfo(); loadActivityLogs(); }} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Security Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-success" />
              Session Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-success" />
              <span className="text-2xl font-bold">Active</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {sessions.length} active session{sessions.length !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Last Login
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {lastLogin ? format(new Date(lastLogin), 'MMM d') : 'Unknown'}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {lastLogin ? format(new Date(lastLogin), 'h:mm a') : 'No data'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Remember Me
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {rememberMeEnabled ? (
                <>
                  <CheckCircle className="h-5 w-5 text-success" />
                  <span className="text-2xl font-bold">Enabled</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-muted-foreground" />
                  <span className="text-2xl font-bold">Disabled</span>
                </>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {rememberMeEnabled ? 'Auto sign-in active' : 'Manual sign-in required'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Active Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Active Sessions
          </CardTitle>
          <CardDescription>
            Manage and monitor your active login sessions across devices
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessions.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No active sessions found. Please sign in to view session information.
              </AlertDescription>
            </Alert>
          ) : (
            sessions.map((session) => {
              const DeviceIcon = getDeviceIcon(session.userAgent);
              const statusInfo = getSessionStatus(session.expiresAt);
              
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <DeviceIcon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">
                          {session.isCurrent ? 'This Device' : 'Other Device'}
                        </span>
                        {session.isCurrent && (
                          <Badge variant="secondary" className="text-xs">
                            Current
                          </Badge>
                        )}
                        <Badge variant={statusInfo.variant} className="text-xs">
                          {statusInfo.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last active: {format(new Date(session.updatedAt), 'MMM d, h:mm a')}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Expires: {format(new Date(session.expiresAt), 'MMM d, h:mm a')}
                        </div>
                      </div>
                      {session.ipAddress && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {session.ipAddress}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {session.isCurrent && (
                      <Button
                        onClick={handleRefresh}
                        variant="outline"
                        size="sm"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                      </Button>
                    )}
                    <Button
                      onClick={handleRevokeCurrentSession}
                      variant="destructive"
                      size="sm"
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Sign Out
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Security Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Security Actions</CardTitle>
          <CardDescription>
            Advanced security controls for your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Shield className="h-4 w-4" />
            <AlertDescription>
              Signing out from all devices will end all active sessions and require you to sign in again.
            </AlertDescription>
          </Alert>
          
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <div className="font-semibold">Sign Out All Devices</div>
              <p className="text-sm text-muted-foreground">
                End all active sessions across all devices immediately
              </p>
            </div>
            <Button
              onClick={handleSignOutAllSessions}
              variant="destructive"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out All
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Login Activity History
          </CardTitle>
          <CardDescription>
            Recent authentication activity and login attempts on your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] pr-4">
            {activityLogs.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No activity logs found. Activity will appear here as you use the system.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                {activityLogs.map((log) => {
                  const isSuccess = log.success;
                  const eventIcon = log.event_type === 'login_success' ? CheckCircle :
                                   log.event_type === 'login_failed' ? XCircle :
                                   log.event_type === 'logout' ? LogOut :
                                   log.event_type === 'session_refresh' ? RefreshCw :
                                   Shield;
                  
                  const eventColor = isSuccess ? 'text-success' : 'text-destructive';
                  const DeviceIcon = log.device_info === 'Mobile' ? Smartphone :
                                    log.device_info === 'Tablet' ? Smartphone :
                                    Monitor;
                  
                  return (
                    <div
                      key={log.id}
                      className="flex items-start gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className={`p-2 rounded-lg ${isSuccess ? 'bg-success/10' : 'bg-destructive/10'}`}>
                        {createElement(eventIcon, { className: `h-4 w-4 ${eventColor}` })}
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold capitalize">
                            {log.event_type.replace(/_/g, ' ')}
                          </span>
                          <Badge variant={isSuccess ? 'default' : 'destructive'} className="text-xs">
                            {isSuccess ? 'Success' : 'Failed'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{log.email}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {format(new Date(log.created_at), 'MMM d, yyyy h:mm a')}
                          </div>
                          {log.location_info && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {log.location_info}
                            </div>
                          )}
                          {log.ip_address && !log.location_info && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {log.ip_address}
                            </div>
                          )}
                          {log.device_info && (
                            <div className="flex items-center gap-1">
                              <DeviceIcon className="h-3 w-3" />
                              {log.device_info}
                            </div>
                          )}
                        </div>
                        {log.error_message && (
                          <p className="text-xs text-destructive mt-1">
                            Error: {log.error_message}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Security Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-success" />
            Security Tips
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
              <span>Use "Remember Me" only on trusted devices</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
              <span>Regularly review your active sessions for suspicious activity</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
              <span>Sign out from all devices if you suspect unauthorized access</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
              <span>Use a strong, unique password for your account</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};
