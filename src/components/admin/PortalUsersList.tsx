/**
 * Portal Users List Component
 * Displays all homeowners with portal access
 */

import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, ChevronRight, Circle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { usePortalUsers, PortalUser } from "@/hooks/usePortalAdmin";

interface PortalUsersListProps {
  onSelectUser: (user: PortalUser) => void;
  selectedUserId?: string;
  filter?: "all" | "active" | "online";
}

export const PortalUsersList: React.FC<PortalUsersListProps> = ({
  onSelectUser,
  selectedUserId,
  filter = "all",
}) => {
  const { data: users, isLoading } = usePortalUsers();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredUsers = React.useMemo(() => {
    if (!users) return [];

    let filtered = users;

    // Apply filter
    if (filter === "active") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      filtered = filtered.filter(
        u => u.last_login && new Date(u.last_login) >= today
      );
    } else if (filter === "online") {
      filtered = filtered.filter(u => u.is_online);
    }

    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        u =>
          u.first_name?.toLowerCase().includes(query) ||
          u.last_name?.toLowerCase().includes(query) ||
          u.email?.toLowerCase().includes(query) ||
          u.project_name?.toLowerCase().includes(query) ||
          u.project_address?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [users, filter, searchQuery]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, email, or project..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Users Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Homeowner</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No portal users found
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers.map(user => (
                <TableRow
                  key={user.id}
                  className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                    selectedUserId === user.id ? "bg-muted" : ""
                  }`}
                  onClick={() => onSelectUser(user)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/10 text-primary text-sm">
                            {user.first_name?.[0]}
                            {user.last_name?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        {user.is_online && (
                          <Circle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-green-500 text-green-500" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">
                          {user.first_name} {user.last_name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.project_name ? (
                      <div>
                        <p className="font-medium">{user.project_name}</p>
                        <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                          {user.project_address}
                        </p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.is_online ? (
                      <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                        Online
                      </Badge>
                    ) : user.last_login ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="outline">Invited</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.last_login ? (
                      <span className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(user.last_login), {
                          addSuffix: true,
                        })}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        Showing {filteredUsers.length} of {users?.length || 0} users
      </p>
    </div>
  );
};
