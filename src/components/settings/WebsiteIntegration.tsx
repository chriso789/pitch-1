import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Code, Copy, Zap, Globe, Mail, FileCode, CheckCircle2 } from 'lucide-react';

export function WebsiteIntegration() {
  const { toast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);

  const webhookUrl = 'https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/external-lead-webhook';

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopied(id);
    toast({
      title: 'Copied',
      description: 'Code copied to clipboard',
    });
    setTimeout(() => setCopied(null), 2000);
  };

  const htmlFormCode = `<!-- PITCH CRM Lead Capture Form -->
<form id="pitch-lead-form" onsubmit="submitToPitch(event)">
  <input type="text" name="first_name" placeholder="First Name" required />
  <input type="text" name="last_name" placeholder="Last Name" />
  <input type="email" name="email" placeholder="Email" />
  <input type="tel" name="phone" placeholder="Phone" required />
  <input type="text" name="address" placeholder="Address" />
  <textarea name="message" placeholder="How can we help?"></textarea>
  <button type="submit">Submit</button>
</form>

<script>
async function submitToPitch(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  
  try {
    const response = await fetch('${webhookUrl}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: 'YOUR_API_KEY_HERE', // Replace with your API key
        lead: {
          first_name: formData.get('first_name'),
          last_name: formData.get('last_name'),
          email: formData.get('email'),
          phone: formData.get('phone'),
          address: formData.get('address'),
          message: formData.get('message'),
          lead_source: 'website_form',
          source_url: window.location.href
        }
      })
    });
    
    const result = await response.json();
    if (result.success) {
      alert('Thank you! We will contact you soon.');
      form.reset();
    } else {
      alert('Something went wrong. Please try again.');
    }
  } catch (error) {
    alert('Something went wrong. Please try again.');
  }
}
</script>`;

  const jsCodeSnippet = `// Submit lead to PITCH CRM
async function submitLeadToPitch(leadData) {
  const response = await fetch('${webhookUrl}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: 'YOUR_API_KEY_HERE',
      lead: {
        first_name: leadData.firstName,
        last_name: leadData.lastName,
        email: leadData.email,
        phone: leadData.phone,
        address: leadData.address,
        city: leadData.city,
        state: leadData.state,
        zip: leadData.zip,
        message: leadData.message,
        lead_source: 'website_form',
        source_url: window.location.href,
        appointment_requested: leadData.preferredDate // ISO 8601 format
      }
    })
  });
  
  return response.json();
}

// Example usage:
// submitLeadToPitch({
//   firstName: 'John',
//   lastName: 'Doe',
//   email: 'john@example.com',
//   phone: '555-123-4567',
//   address: '123 Main St',
//   city: 'Miami',
//   state: 'FL',
//   zip: '33101',
//   message: 'I need a roof inspection'
// });`;

  const curlExample = `curl -X POST '${webhookUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "api_key": "YOUR_API_KEY_HERE",
    "lead": {
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "phone": "555-123-4567",
      "address": "123 Main St, Miami, FL 33101",
      "message": "I need a roof inspection",
      "lead_source": "api_test"
    }
  }'`;

  const zapierInstructions = `Zapier Integration Setup:

1. Create a new Zap
2. Set your trigger (e.g., New Form Submission, New Typeform Response, etc.)
3. Add action: "Webhooks by Zapier" → "POST"
4. Configure the webhook:
   
   URL: ${webhookUrl}
   
   Payload Type: json
   
   Data:
   {
     "api_key": "YOUR_API_KEY_HERE",
     "lead": {
       "first_name": "{{First Name Field}}",
       "last_name": "{{Last Name Field}}",
       "email": "{{Email Field}}",
       "phone": "{{Phone Field}}",
       "address": "{{Address Field}}",
       "message": "{{Message Field}}",
       "lead_source": "zapier"
     }
   }

5. Test and enable your Zap`;

  const wordpressCode = `<!-- WordPress Contact Form 7 Integration -->
<!-- Add this to your functions.php or a custom plugin -->

<?php
add_action('wpcf7_mail_sent', 'send_to_pitch_crm');

function send_to_pitch_crm($contact_form) {
    $submission = WPCF7_Submission::get_instance();
    if (!$submission) return;
    
    $posted_data = $submission->get_posted_data();
    
    $payload = array(
        'api_key' => 'YOUR_API_KEY_HERE',
        'lead' => array(
            'first_name' => $posted_data['first-name'] ?? '',
            'last_name' => $posted_data['last-name'] ?? '',
            'email' => $posted_data['email'] ?? '',
            'phone' => $posted_data['phone'] ?? '',
            'address' => $posted_data['address'] ?? '',
            'message' => $posted_data['message'] ?? '',
            'lead_source' => 'contact_form_7',
            'source_url' => $_SERVER['HTTP_REFERER'] ?? ''
        )
    );
    
    wp_remote_post('${webhookUrl}', array(
        'body' => json_encode($payload),
        'headers' => array('Content-Type' => 'application/json'),
        'timeout' => 30
    ));
}
?>`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <CardTitle>Website Integration</CardTitle>
        </div>
        <CardDescription>
          Integrate your website or forms to automatically capture leads in PITCH CRM
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="html" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="html" className="flex items-center gap-1">
              <FileCode className="h-4 w-4" />
              HTML
            </TabsTrigger>
            <TabsTrigger value="javascript" className="flex items-center gap-1">
              <Code className="h-4 w-4" />
              JavaScript
            </TabsTrigger>
            <TabsTrigger value="curl" className="flex items-center gap-1">
              <Code className="h-4 w-4" />
              cURL
            </TabsTrigger>
            <TabsTrigger value="zapier" className="flex items-center gap-1">
              <Zap className="h-4 w-4" />
              Zapier
            </TabsTrigger>
            <TabsTrigger value="wordpress" className="flex items-center gap-1">
              <Globe className="h-4 w-4" />
              WordPress
            </TabsTrigger>
          </TabsList>

          <TabsContent value="html" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">HTML Form with JavaScript</h4>
                <p className="text-sm text-muted-foreground">
                  Copy and paste this complete form into your website
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyCode(htmlFormCode, 'html')}
              >
                {copied === 'html' ? <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
                Copy Code
              </Button>
            </div>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs">
              <code>{htmlFormCode}</code>
            </pre>
          </TabsContent>

          <TabsContent value="javascript" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">JavaScript Function</h4>
                <p className="text-sm text-muted-foreground">
                  Use this function to submit leads from any JavaScript application
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyCode(jsCodeSnippet, 'js')}
              >
                {copied === 'js' ? <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
                Copy Code
              </Button>
            </div>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs">
              <code>{jsCodeSnippet}</code>
            </pre>
          </TabsContent>

          <TabsContent value="curl" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">cURL Command</h4>
                <p className="text-sm text-muted-foreground">
                  Test the API from your terminal or use in backend scripts
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyCode(curlExample, 'curl')}
              >
                {copied === 'curl' ? <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
                Copy Code
              </Button>
            </div>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs">
              <code>{curlExample}</code>
            </pre>
          </TabsContent>

          <TabsContent value="zapier" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">Zapier Integration</h4>
                <p className="text-sm text-muted-foreground">
                  Connect any app through Zapier's webhook action
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyCode(zapierInstructions, 'zapier')}
              >
                {copied === 'zapier' ? <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
                Copy Instructions
              </Button>
            </div>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs whitespace-pre-wrap">
              <code>{zapierInstructions}</code>
            </pre>
          </TabsContent>

          <TabsContent value="wordpress" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium">WordPress / Contact Form 7</h4>
                <p className="text-sm text-muted-foreground">
                  Automatically send form submissions to PITCH CRM
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyCode(wordpressCode, 'wordpress')}
              >
                {copied === 'wordpress' ? <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
                Copy Code
              </Button>
            </div>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs">
              <code>{wordpressCode}</code>
            </pre>
          </TabsContent>
        </Tabs>

        {/* API Response Format */}
        <div className="mt-6 pt-6 border-t">
          <h4 className="font-medium mb-2">API Response Format</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="default" className="bg-green-500">Success (200)</Badge>
              </div>
              <pre className="text-xs text-green-800">
{`{
  "success": true,
  "data": {
    "lead_id": "uuid",
    "contact_id": "uuid",
    "appointment_id": "uuid",
    "is_duplicate": false,
    "lead_number": "EXT-ABC123"
  }
}`}
              </pre>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="destructive">Error (4xx/5xx)</Badge>
              </div>
              <pre className="text-xs text-red-800">
{`{
  "success": false,
  "error": "Error message here"
}

// Common errors:
// 401: Invalid or expired API key
// 400: Missing required fields
// 429: Rate limit exceeded
// 403: IP not authorized`}
              </pre>
            </div>
          </div>
        </div>

        {/* Required Fields */}
        <div className="mt-6 pt-6 border-t">
          <h4 className="font-medium mb-2">Required Fields</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Badge variant="destructive">Required</Badge>
              <span className="text-sm">first_name</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="destructive">Required</Badge>
              <span className="text-sm">phone</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Optional</Badge>
              <span className="text-sm">last_name</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Optional</Badge>
              <span className="text-sm">email</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Optional</Badge>
              <span className="text-sm">address</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Optional</Badge>
              <span className="text-sm">message</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Optional</Badge>
              <span className="text-sm">lead_source</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Optional</Badge>
              <span className="text-sm">appointment_requested</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
