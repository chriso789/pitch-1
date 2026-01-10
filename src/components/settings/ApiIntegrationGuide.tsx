import React, { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Book, ChevronDown, ChevronUp, Copy, Code, FileCode, Globe, Braces } from 'lucide-react';

interface ApiIntegrationGuideProps {
  webhookUrl: string;
}

export function ApiIntegrationGuide({ webhookUrl }: ApiIntegrationGuideProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: `${label} copied to clipboard`,
    });
  };

  const minimalPayload = `{
  "api_key": "YOUR_API_KEY_HERE",
  "lead": {
    "first_name": "John",
    "phone": "407-555-1234"
  }
}`;

  const fullPayload = `{
  "api_key": "pk_live_xxxxx",
  "lead": {
    "first_name": "John",           // Required
    "last_name": "Smith",           // Optional
    "phone": "407-555-1234",        // Required
    "email": "john@example.com",    // Optional
    "address": "123 Main St",       // Optional
    "city": "Orlando",              // Optional
    "state": "FL",                  // Optional
    "zip": "32801",                 // Optional
    "message": "Interested in new roof",  // Optional
    "lead_source": "website_form",        // Optional
    "source_url": "https://yoursite.com", // Optional
    "service_type": "Roof Replacement",   // Optional - appears in appointment
    "appointment_date": "2025-01-15",     // Optional - creates appointment
    "appointment_time": "2:30 PM",        // Optional - time for appointment
    "appointment_notes": "Customer prefers afternoon",  // Optional
    "custom_fields": {}                   // Optional - any extra data
  }
}`;

  const successResponse = `{
  "success": true,
  "data": {
    "lead_id": "uuid-pipeline-entry-id",
    "contact_id": "uuid-contact-id",
    "appointment_id": "uuid-or-null",
    "is_duplicate": false,
    "lead_number": "EXT-ABC123-XYZ",
    "assigned_to": "uuid-assignee-or-null"
  }
}`;

  const errorResponse = `{
  "success": false,
  "error": "Error description here"
}`;

  const javascriptExample = `// Submit lead to PITCH CRM
async function submitLead(formData) {
  const response = await fetch('${webhookUrl}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: 'YOUR_API_KEY_HERE',
      lead: {
        first_name: formData.firstName,
        last_name: formData.lastName,
        phone: formData.phone,
        email: formData.email,
        message: formData.message,
        service_type: formData.serviceType
      }
    })
  });
  
  const result = await response.json();
  
  if (result.success) {
    console.log('Lead created:', result.data.lead_number);
    return result.data;
  } else {
    throw new Error(result.error);
  }
}`;

  const phpExample = `<?php
// Submit lead to PITCH CRM
function submitLead($formData) {
    $payload = json_encode([
        'api_key' => 'YOUR_API_KEY_HERE',
        'lead' => [
            'first_name' => $formData['first_name'],
            'last_name' => $formData['last_name'] ?? '',
            'phone' => $formData['phone'],
            'email' => $formData['email'] ?? '',
            'message' => $formData['message'] ?? '',
            'service_type' => $formData['service_type'] ?? ''
        ]
    ]);

    $ch = curl_init('${webhookUrl}');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json'
    ]);

    $response = curl_exec($ch);
    curl_close($ch);

    return json_decode($response, true);
}
?>`;

  const htmlFormExample = `<form id="lead-form">
  <input name="first_name" required placeholder="First Name">
  <input name="last_name" placeholder="Last Name">
  <input name="phone" required placeholder="Phone">
  <input name="email" type="email" placeholder="Email">
  <select name="service_type">
    <option value="Roof Replacement">Roof Replacement</option>
    <option value="Roof Repair">Roof Repair</option>
    <option value="Inspection">Inspection</option>
    <option value="Storm Damage">Storm Damage Assessment</option>
  </select>
  <textarea name="message" placeholder="Message"></textarea>
  <button type="submit">Request Quote</button>
</form>

<script>
document.getElementById('lead-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  
  const response = await fetch('${webhookUrl}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: 'YOUR_API_KEY_HERE',
      lead: Object.fromEntries(form)
    })
  });
  
  const result = await response.json();
  if (result.success) {
    alert('Thank you! We will contact you shortly.');
    e.target.reset();
  } else {
    alert('Error: ' + result.error);
  }
});
</script>`;

  const wordpressExample = `<?php
/**
 * WordPress Integration - Add to your theme's functions.php
 * or create a custom plugin
 */

// Handle form submission via AJAX
add_action('wp_ajax_submit_pitch_lead', 'handle_pitch_lead_submission');
add_action('wp_ajax_nopriv_submit_pitch_lead', 'handle_pitch_lead_submission');

function handle_pitch_lead_submission() {
    // Verify nonce for security
    check_ajax_referer('pitch_lead_nonce', 'security');
    
    $payload = json_encode([
        'api_key' => 'YOUR_API_KEY_HERE',
        'lead' => [
            'first_name' => sanitize_text_field($_POST['first_name']),
            'last_name' => sanitize_text_field($_POST['last_name']),
            'phone' => sanitize_text_field($_POST['phone']),
            'email' => sanitize_email($_POST['email']),
            'address' => sanitize_text_field($_POST['address']),
            'city' => sanitize_text_field($_POST['city']),
            'state' => sanitize_text_field($_POST['state']),
            'zip' => sanitize_text_field($_POST['zip']),
            'message' => sanitize_textarea_field($_POST['message']),
            'service_type' => sanitize_text_field($_POST['service_type']),
            'lead_source' => 'wordpress',
            'source_url' => home_url($_SERVER['REQUEST_URI'])
        ]
    ]);
    
    $response = wp_remote_post('${webhookUrl}', [
        'headers' => ['Content-Type' => 'application/json'],
        'body' => $payload,
        'timeout' => 30
    ]);
    
    if (is_wp_error($response)) {
        wp_send_json_error(['message' => $response->get_error_message()]);
    }
    
    $body = json_decode(wp_remote_retrieve_body($response), true);
    
    if ($body['success']) {
        wp_send_json_success($body['data']);
    } else {
        wp_send_json_error(['message' => $body['error']]);
    }
}

// Enqueue JavaScript
add_action('wp_enqueue_scripts', function() {
    wp_enqueue_script('pitch-lead-form', get_template_directory_uri() . '/js/lead-form.js', ['jquery'], '1.0', true);
    wp_localize_script('pitch-lead-form', 'pitchAjax', [
        'url' => admin_url('admin-ajax.php'),
        'nonce' => wp_create_nonce('pitch_lead_nonce')
    ]);
});
?>`;

  const curlExample = `curl -X POST '${webhookUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "api_key": "YOUR_API_KEY_HERE",
    "lead": {
      "first_name": "John",
      "last_name": "Smith",
      "phone": "407-555-1234",
      "email": "john@example.com",
      "service_type": "Roof Replacement",
      "message": "Interested in a quote"
    }
  }'`;

  const errorCodes = [
    { code: '401', error: 'API key is required', description: 'Missing api_key in payload' },
    { code: '401', error: 'Invalid or expired API key', description: 'Key not found, revoked, or inactive' },
    { code: '400', error: 'first_name and phone are required', description: 'Missing required lead fields' },
    { code: '403', error: 'IP address not authorized', description: 'IP not in allowlist (if configured)' },
    { code: '429', error: 'Rate limit exceeded', description: 'Too many requests per hour' },
    { code: '500', error: 'Internal server error', description: 'Server-side error - contact support' },
  ];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border rounded-lg">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full flex items-center justify-between p-4 h-auto">
          <div className="flex items-center gap-2">
            <Book className="h-5 w-5 text-primary" />
            <span className="font-medium">Integration Guide</span>
            <Badge variant="secondary" className="ml-2">Developer Docs</Badge>
          </div>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="px-4 pb-4">
        <Tabs defaultValue="quickstart" className="w-full">
          <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-muted/50 p-1">
            <TabsTrigger value="quickstart" className="text-xs">Quick Start</TabsTrigger>
            <TabsTrigger value="payload" className="text-xs">Full Payload</TabsTrigger>
            <TabsTrigger value="examples" className="text-xs">Code Examples</TabsTrigger>
            <TabsTrigger value="errors" className="text-xs">Error Codes</TabsTrigger>
          </TabsList>

          {/* Quick Start */}
          <TabsContent value="quickstart" className="space-y-4 mt-4">
            <div>
              <h4 className="font-medium mb-2">Webhook URL</h4>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-3 py-2 rounded text-xs font-mono break-all">
                  {webhookUrl}
                </code>
                <Button variant="outline" size="sm" onClick={() => copyToClipboard(webhookUrl, 'Webhook URL')}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">Minimum Required Payload</h4>
              <div className="relative">
                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                  <code>{minimalPayload}</code>
                </pre>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(minimalPayload, 'Minimal payload')}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">cURL Example</h4>
              <div className="relative">
                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap">
                  <code>{curlExample}</code>
                </pre>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(curlExample, 'cURL command')}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* Full Payload */}
          <TabsContent value="payload" className="space-y-4 mt-4">
            <div>
              <h4 className="font-medium mb-2">Full Payload Reference</h4>
              <div className="relative">
                <pre className="bg-muted p-3 rounded text-xs overflow-x-auto max-h-80">
                  <code>{fullPayload}</code>
                </pre>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="absolute top-2 right-2"
                  onClick={() => copyToClipboard(fullPayload.replace(/\/\/.*$/gm, ''), 'Full payload')}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-medium mb-2 text-green-600 dark:text-green-400">Success Response (200)</h4>
                <pre className="bg-green-50 dark:bg-green-950/30 p-3 rounded text-xs overflow-x-auto border border-green-200 dark:border-green-800">
                  <code>{successResponse}</code>
                </pre>
              </div>
              <div>
                <h4 className="font-medium mb-2 text-red-600 dark:text-red-400">Error Response (4xx/5xx)</h4>
                <pre className="bg-red-50 dark:bg-red-950/30 p-3 rounded text-xs overflow-x-auto border border-red-200 dark:border-red-800">
                  <code>{errorResponse}</code>
                </pre>
              </div>
            </div>
          </TabsContent>

          {/* Code Examples */}
          <TabsContent value="examples" className="mt-4">
            <Tabs defaultValue="javascript" className="w-full">
              <TabsList className="w-full justify-start h-auto gap-1 bg-transparent border-b rounded-none pb-0">
                <TabsTrigger value="javascript" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
                  <Code className="h-3 w-3 mr-1" />
                  JavaScript
                </TabsTrigger>
                <TabsTrigger value="php" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
                  <FileCode className="h-3 w-3 mr-1" />
                  PHP
                </TabsTrigger>
                <TabsTrigger value="html" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
                  <Globe className="h-3 w-3 mr-1" />
                  HTML Form
                </TabsTrigger>
                <TabsTrigger value="wordpress" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none">
                  <Braces className="h-3 w-3 mr-1" />
                  WordPress
                </TabsTrigger>
              </TabsList>

              <TabsContent value="javascript" className="mt-4">
                <div className="relative">
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto max-h-96">
                    <code>{javascriptExample}</code>
                  </pre>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(javascriptExample, 'JavaScript code')}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="php" className="mt-4">
                <div className="relative">
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto max-h-96">
                    <code>{phpExample}</code>
                  </pre>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(phpExample, 'PHP code')}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="html" className="mt-4">
                <div className="relative">
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto max-h-96">
                    <code>{htmlFormExample}</code>
                  </pre>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(htmlFormExample, 'HTML form code')}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="wordpress" className="mt-4">
                <div className="relative">
                  <pre className="bg-muted p-3 rounded text-xs overflow-x-auto max-h-96">
                    <code>{wordpressExample}</code>
                  </pre>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(wordpressExample, 'WordPress code')}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* Error Codes */}
          <TabsContent value="errors" className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errorCodes.map((err, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Badge variant={err.code.startsWith('4') ? 'secondary' : 'destructive'}>
                        {err.code}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{err.error}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{err.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </CollapsibleContent>
    </Collapsible>
  );
}
