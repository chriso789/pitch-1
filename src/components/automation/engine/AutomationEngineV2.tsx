import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RulesList } from './RulesList';
import { TemplatesPanel } from './TemplatesPanel';
import { RunsLog } from './RunsLog';
import { EventTypesReference } from './EventTypesReference';

/**
 * Engine v2 — the new event-driven automation engine UI.
 * Lives inside the existing /automation page as a sibling tab to the legacy
 * Workflow Tasks dashboard, so we don't fork the navigation.
 */
export function AutomationEngineV2() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Automation Engine</h2>
        <p className="text-sm text-muted-foreground">
          Event-driven rules per company. Rules listen for events (lead created, permit approved, payment received…)
          and run actions like creating tasks, sending messages, and refreshing AI memory.
        </p>
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="pt-4"><RulesList /></TabsContent>
        <TabsContent value="templates" className="pt-4"><TemplatesPanel /></TabsContent>
        <TabsContent value="runs" className="pt-4"><RunsLog /></TabsContent>
        <TabsContent value="events" className="pt-4"><EventTypesReference /></TabsContent>
      </Tabs>
    </div>
  );
}
