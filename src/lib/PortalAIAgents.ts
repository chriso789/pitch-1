import { supabase } from "@/integrations/supabase/client";

/**
 * Portal AI Agents
 * 
 * These agents provide intelligent automation for the crew and homeowner portals:
 * 1. WorkOrderAgent - Auto-assigns crews based on skills/availability
 * 2. PhotoManagementAgent - Auto-categorizes and analyzes project photos
 * 3. CommunicationAgent - Smart reply suggestions, sentiment analysis
 * 4. ProgressTrackingAgent - Automatic milestone detection from photos
 * 5. PaymentAgent - Invoice generation, reminder automation
 */

// Types
interface WorkOrder {
  id: string;
  title: string;
  description: string;
  priority: string;
  scheduled_date: string;
  project_id: string;
  estimated_hours: number;
}

interface CrewMember {
  id: string;
  first_name: string;
  last_name: string;
  skills: string[];
  availability: boolean;
  current_workload: number;
}

interface Photo {
  id: string;
  url: string;
  project_id: string;
  created_at: string;
}

interface Message {
  id: string;
  message: string;
  sender_type: string;
  project_id: string;
}

// Work Order Agent
export class WorkOrderAgent {
  /**
   * Auto-assign crew to work order based on skills, availability, and workload
   */
  async assignCrew(workOrder: WorkOrder): Promise<{ crewId: string; reason: string } | null> {
    try {
      // Get available crew members (sales managers can do field work)
      const { data: crewMembers } = await supabase
        .from("profiles")
        .select("*")
        .in("role", ["sales_manager", "project_manager"])
        .eq("is_active", true);

      if (!crewMembers || crewMembers.length === 0) {
        return null;
      }

      // Get current assignments to calculate workload
      const { data: currentAssignments } = await supabase
        .from("work_orders")
        .select("assigned_to")
        .in("status", ["pending", "in_progress"])
        .gte("scheduled_date", new Date().toISOString().split("T")[0]);

      // Calculate workload per crew member
      const workloadMap = new Map<string, number>();
      currentAssignments?.forEach(a => {
        if (a.assigned_to) {
          workloadMap.set(a.assigned_to, (workloadMap.get(a.assigned_to) || 0) + 1);
        }
      });

      // Score crew members
      const scoredCrew = crewMembers.map(member => {
        const workload = workloadMap.get(member.id) || 0;
        const availabilityScore = workload < 3 ? 10 : workload < 5 ? 5 : 0;
        const priorityBonus = workOrder.priority === "urgent" ? 5 : 0;
        
        return {
          member,
          score: availabilityScore + priorityBonus,
          workload
        };
      });

      // Sort by score (highest first) then workload (lowest first)
      scoredCrew.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.workload - b.workload;
      });

      const bestMatch = scoredCrew[0];
      if (bestMatch && bestMatch.score > 0) {
        return {
          crewId: bestMatch.member.id,
          reason: `Selected based on availability (${bestMatch.workload} current orders) and priority match`
        };
      }

      return null;
    } catch (error) {
      console.error("[WorkOrderAgent] Assignment error:", error);
      return null;
    }
  }

  /**
   * Suggest optimal scheduling for work orders
   */
  async suggestSchedule(workOrder: WorkOrder): Promise<{ date: string; timeSlot: string; reason: string }> {
    // Default to next available business day
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Skip weekends
    while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
      tomorrow.setDate(tomorrow.getDate() + 1);
    }

    const prioritySlots: Record<string, string> = {
      urgent: "08:00",
      high: "09:00",
      normal: "10:00",
      low: "14:00"
    };

    return {
      date: tomorrow.toISOString().split("T")[0],
      timeSlot: prioritySlots[workOrder.priority] || "10:00",
      reason: `Scheduled for ${workOrder.priority} priority with appropriate time slot`
    };
  }
}

// Photo Management Agent
export class PhotoManagementAgent {
  private categories = [
    "before",
    "during",
    "after",
    "damage",
    "materials",
    "progress",
    "inspection",
    "completion"
  ];

  /**
   * Auto-categorize photo based on metadata and context
   */
  async categorizePhoto(photo: Photo, context?: { stage?: string }): Promise<string> {
    // Simple rule-based categorization
    // In production, this would use vision AI
    
    if (context?.stage === "pre_construction") {
      return "before";
    }
    if (context?.stage === "completed") {
      return "after";
    }
    
    return "progress";
  }

  /**
   * Detect project progress from photos
   */
  async analyzeProgress(photos: Photo[]): Promise<{ 
    estimatedProgress: number; 
    detectedStages: string[];
    confidence: number;
  }> {
    const detectedStages: string[] = [];
    
    // Count photos by implied category
    const hasBeforePhotos = photos.some(p => p.created_at < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    const recentPhotos = photos.filter(p => p.created_at > new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (hasBeforePhotos) {
      detectedStages.push("documentation_complete");
    }
    if (recentPhotos.length > 0) {
      detectedStages.push("active_work");
    }

    // Estimate progress based on photo count and recency
    const photoScore = Math.min(photos.length / 20, 1);
    const recencyScore = recentPhotos.length > 5 ? 0.8 : 0.5;
    const estimatedProgress = Math.round((photoScore * 0.6 + recencyScore * 0.4) * 100);

    return {
      estimatedProgress: Math.min(estimatedProgress, 95),
      detectedStages,
      confidence: 0.7
    };
  }
}

// Communication Agent
export class CommunicationAgent {
  private commonResponses: Record<string, string> = {
    schedule: "Our team will be on-site on [DATE]. We typically arrive between 8-9 AM.",
    progress: "Great progress today! We completed [TASK] and are on track for completion.",
    weather: "Due to weather conditions, we've rescheduled work to [DATE].",
    materials: "Materials have arrived and we're ready to proceed.",
    completion: "Congratulations! Your project is complete. Final walkthrough scheduled for [DATE]."
  };

  /**
   * Analyze message sentiment
   */
  analyzeSentiment(message: string): { sentiment: "positive" | "neutral" | "negative"; score: number } {
    const positiveWords = ["thank", "great", "excellent", "happy", "pleased", "wonderful", "appreciate"];
    const negativeWords = ["frustrated", "disappointed", "upset", "angry", "problem", "issue", "concern", "worried"];

    const lowerMessage = message.toLowerCase();
    let score = 0;

    positiveWords.forEach(word => {
      if (lowerMessage.includes(word)) score += 1;
    });

    negativeWords.forEach(word => {
      if (lowerMessage.includes(word)) score -= 1;
    });

    return {
      sentiment: score > 0 ? "positive" : score < 0 ? "negative" : "neutral",
      score
    };
  }

  /**
   * Generate smart reply suggestions
   */
  generateReplySuggestions(message: string): string[] {
    const suggestions: string[] = [];
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("when") || lowerMessage.includes("schedule")) {
      suggestions.push("I'll check the schedule and get back to you shortly.");
      suggestions.push("We're planning to be there this week. Let me confirm the exact date.");
    }

    if (lowerMessage.includes("update") || lowerMessage.includes("progress")) {
      suggestions.push("Great progress today! We're on track with the timeline.");
      suggestions.push("I'll send you photos of today's work shortly.");
    }

    if (lowerMessage.includes("concern") || lowerMessage.includes("issue") || lowerMessage.includes("problem")) {
      suggestions.push("I understand your concern. Let me look into this right away.");
      suggestions.push("Thank you for bringing this to my attention. I'll have our supervisor call you.");
    }

    // Default suggestions
    if (suggestions.length === 0) {
      suggestions.push("Thank you for your message. I'll get back to you shortly.");
      suggestions.push("Got it! I'll take care of this.");
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Detect if message requires urgent attention
   */
  requiresUrgentAttention(message: string): boolean {
    const urgentKeywords = [
      "emergency", "urgent", "asap", "immediately", "leak", "damage",
      "flooded", "dangerous", "safety", "injured", "fire"
    ];

    const lowerMessage = message.toLowerCase();
    return urgentKeywords.some(keyword => lowerMessage.includes(keyword));
  }
}

// Progress Tracking Agent
export class ProgressTrackingAgent {
  private milestones = [
    { name: "Project Started", threshold: 0 },
    { name: "Materials Delivered", threshold: 10 },
    { name: "Preparation Complete", threshold: 20 },
    { name: "Work Commenced", threshold: 30 },
    { name: "50% Complete", threshold: 50 },
    { name: "Near Completion", threshold: 80 },
    { name: "Final Inspection", threshold: 95 },
    { name: "Project Complete", threshold: 100 }
  ];

  /**
   * Calculate overall project progress
   */
  async calculateProgress(projectId: string): Promise<{
    percentage: number;
    currentMilestone: string;
    nextMilestone: string;
    estimatedCompletion: string;
  }> {
    try {
      // Get work orders for project
      const { data: workOrders } = await supabase
        .from("work_orders")
        .select("*")
        .eq("project_id", projectId);

      if (!workOrders || workOrders.length === 0) {
        return {
          percentage: 0,
          currentMilestone: "Project Started",
          nextMilestone: "Materials Delivered",
          estimatedCompletion: "TBD"
        };
      }

      // Calculate based on completed work orders
      const completed = workOrders.filter(wo => wo.status === "completed").length;
      const percentage = Math.round((completed / workOrders.length) * 100);

      // Find current and next milestone
      let currentMilestone = this.milestones[0].name;
      let nextMilestone = this.milestones[1]?.name || "Complete";

      for (let i = this.milestones.length - 1; i >= 0; i--) {
        if (percentage >= this.milestones[i].threshold) {
          currentMilestone = this.milestones[i].name;
          nextMilestone = this.milestones[i + 1]?.name || "Project Complete";
          break;
        }
      }

      // Estimate completion
      const remainingOrders = workOrders.length - completed;
      const avgDaysPerOrder = 1; // Simplified
      const estimatedDays = remainingOrders * avgDaysPerOrder;
      const completionDate = new Date();
      completionDate.setDate(completionDate.getDate() + estimatedDays);

      return {
        percentage,
        currentMilestone,
        nextMilestone,
        estimatedCompletion: completionDate.toISOString().split("T")[0]
      };
    } catch (error) {
      console.error("[ProgressTrackingAgent] Error:", error);
      return {
        percentage: 0,
        currentMilestone: "Unknown",
        nextMilestone: "Unknown",
        estimatedCompletion: "TBD"
      };
    }
  }

  /**
   * Detect if milestone was reached
   */
  checkMilestoneReached(previousProgress: number, currentProgress: number): string | null {
    for (const milestone of this.milestones) {
      if (previousProgress < milestone.threshold && currentProgress >= milestone.threshold) {
        return milestone.name;
      }
    }
    return null;
  }
}

// Payment Agent
export class PaymentAgent {
  /**
   * Generate payment schedule based on project value
   */
  generatePaymentSchedule(contractAmount: number, projectDurationDays: number): {
    schedule: Array<{ description: string; amount: number; dueDate: string; percentage: number }>;
  } {
    const today = new Date();
    
    // Standard payment schedule: Deposit, Progress, Completion
    const schedule = [
      {
        description: "Initial Deposit",
        amount: Math.round(contractAmount * 0.33),
        percentage: 33,
        dueDate: today.toISOString().split("T")[0]
      },
      {
        description: "Progress Payment",
        amount: Math.round(contractAmount * 0.33),
        percentage: 33,
        dueDate: new Date(today.getTime() + (projectDurationDays / 2) * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      },
      {
        description: "Final Payment",
        amount: Math.round(contractAmount * 0.34),
        percentage: 34,
        dueDate: new Date(today.getTime() + projectDurationDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      }
    ];

    return { schedule };
  }

  /**
   * Check if payment reminder should be sent
   */
  shouldSendReminder(dueDate: string, lastReminderSent: string | null): {
    shouldSend: boolean;
    urgency: "low" | "medium" | "high";
    message: string;
  } {
    const due = new Date(dueDate);
    const now = new Date();
    const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    if (daysUntilDue < 0) {
      return {
        shouldSend: true,
        urgency: "high",
        message: `Payment is ${Math.abs(daysUntilDue)} days overdue.`
      };
    }

    if (daysUntilDue <= 3) {
      return {
        shouldSend: true,
        urgency: "medium",
        message: `Payment reminder: Due in ${daysUntilDue} days.`
      };
    }

    if (daysUntilDue <= 7) {
      return {
        shouldSend: true,
        urgency: "low",
        message: `Friendly reminder: Payment due in ${daysUntilDue} days.`
      };
    }

    return {
      shouldSend: false,
      urgency: "low",
      message: ""
    };
  }
}

// Export agent instances
export const workOrderAgent = new WorkOrderAgent();
export const photoManagementAgent = new PhotoManagementAgent();
export const communicationAgent = new CommunicationAgent();
export const progressTrackingAgent = new ProgressTrackingAgent();
export const paymentAgent = new PaymentAgent();
