/**
 * User Activity Tab Component
 * Comprehensive activity tracking for user profiles
 */

import React from "react";
import { UserLoginStats } from "./UserLoginStats";
import { UserSessionHistory } from "./UserSessionHistory";
import { UserActivityTimeline } from "./UserActivityTimeline";
import { UserActivityHeatmap } from "./UserActivityHeatmap";
import { SecurityAlerts } from "./SecurityAlerts";

interface UserActivityTabProps {
  userId: string;
}

export const UserActivityTab: React.FC<UserActivityTabProps> = ({ userId }) => {
  return (
    <div className="space-y-6">
      {/* Login Statistics */}
      <UserLoginStats userId={userId} />

      {/* Activity Heatmap */}
      <UserActivityHeatmap userId={userId} />

      {/* Security Alerts */}
      <SecurityAlerts userId={userId} />

      {/* Session History and Activity Timeline side by side on larger screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UserSessionHistory userId={userId} />
        <UserActivityTimeline userId={userId} limit={30} />
      </div>
    </div>
  );
};
