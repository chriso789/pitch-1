import React from 'react';
import LegalPageLayout from '@/components/legal/LegalPageLayout';
import { BRAND } from '@/lib/branding/legal';

const Privacy = () => {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="January 18, 2025">
      <section>
        <h2>1. Introduction</h2>
        <p>
          Welcome to {BRAND.name}. We respect your privacy and are committed to protecting your personal data. 
          This privacy policy explains how we collect, use, disclose, and safeguard your information when you 
          use our construction CRM platform.
        </p>
        <p>
          {BRAND.company} ("we," "us," or "our") operates the {BRAND.name} platform. This Privacy Policy applies 
          to all users of our services, including website visitors, registered users, and business customers.
        </p>
      </section>

      <section>
        <h2>2. Information We Collect</h2>
        
        <h3>2.1 Information You Provide</h3>
        <ul>
          <li><strong>Account Information:</strong> Name, email address, phone number, company name, and job title when you register.</li>
          <li><strong>Business Data:</strong> Customer information, project details, estimates, contracts, and communications you store in our platform.</li>
          <li><strong>Payment Information:</strong> Billing address and payment card details (processed securely through Stripe).</li>
          <li><strong>Communications:</strong> Messages, calls, and interactions recorded through our communication features.</li>
        </ul>

        <h3>2.2 Information We Collect Automatically</h3>
        <ul>
          <li><strong>Device Information:</strong> IP address, browser type, operating system, and device identifiers.</li>
          <li><strong>Usage Data:</strong> Pages visited, features used, time spent, and interaction patterns.</li>
          <li><strong>Location Data:</strong> GPS coordinates when you use our canvassing or territory management features (with your consent).</li>
          <li><strong>Cookies:</strong> We use cookies and similar technologies to enhance your experience. See our Cookie Policy below.</li>
        </ul>

        <h3>2.3 Information from Third Parties</h3>
        <ul>
          <li><strong>Property Data:</strong> We may obtain property information from public records and satellite imagery providers for measurement features.</li>
          <li><strong>Integration Data:</strong> Information from services you connect (Google Calendar, QuickBooks, etc.).</li>
        </ul>
      </section>

      <section>
        <h2>3. How We Use Your Information</h2>
        <p>We use your information to:</p>
        <ul>
          <li>Provide, maintain, and improve our CRM platform and services</li>
          <li>Process transactions and send related information</li>
          <li>Send administrative messages, updates, and security alerts</li>
          <li>Respond to your comments, questions, and customer service requests</li>
          <li>Analyze usage patterns to improve user experience</li>
          <li>Develop new features and functionality</li>
          <li>Prevent fraud and enhance security</li>
          <li>Comply with legal obligations</li>
        </ul>
      </section>

      <section>
        <h2>4. Data Sharing and Disclosure</h2>
        <p>We do not sell your personal information. We may share your information with:</p>
        <ul>
          <li><strong>Service Providers:</strong> Companies that help us operate our platform (hosting, analytics, payment processing).</li>
          <li><strong>Business Partners:</strong> With your consent, for integrations you enable.</li>
          <li><strong>Legal Requirements:</strong> When required by law or to protect our rights.</li>
          <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets.</li>
        </ul>

        <h3>4.1 Third-Party Services We Use</h3>
        <ul>
          <li><strong>Supabase:</strong> Database and authentication infrastructure</li>
          <li><strong>Stripe:</strong> Payment processing</li>
          <li><strong>Telnyx:</strong> Voice and SMS communications</li>
          <li><strong>Google Maps:</strong> Mapping and location services</li>
          <li><strong>OpenAI/Anthropic:</strong> AI features and analysis</li>
        </ul>
      </section>

      <section>
        <h2>5. Data Security</h2>
        <p>
          We implement industry-standard security measures to protect your data, including:
        </p>
        <ul>
          <li>Encryption of data in transit (TLS 1.3) and at rest (AES-256)</li>
          <li>Regular security audits and penetration testing</li>
          <li>Access controls and authentication requirements</li>
          <li>Secure data centers with SOC 2 compliance</li>
          <li>Employee security training and access limitations</li>
        </ul>
        <p>
          For more details, see our <a href="/legal/security">Security Policy</a>.
        </p>
      </section>

      <section>
        <h2>6. Data Retention</h2>
        <p>
          We retain your data for as long as your account is active or as needed to provide services. 
          After account termination, we retain data for a reasonable period for legal, business, and 
          audit purposes. You may request deletion of your data at any time.
        </p>
      </section>

      <section>
        <h2>7. Your Rights and Choices</h2>
        <p>Depending on your location, you may have the right to:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of your personal data</li>
          <li><strong>Correction:</strong> Request correction of inaccurate data</li>
          <li><strong>Deletion:</strong> Request deletion of your data</li>
          <li><strong>Portability:</strong> Receive your data in a structured format</li>
          <li><strong>Restriction:</strong> Request we limit processing of your data</li>
          <li><strong>Objection:</strong> Object to certain processing activities</li>
          <li><strong>Withdraw Consent:</strong> Withdraw previously given consent</li>
        </ul>
        <p>
          To exercise these rights, contact us at <a href={`mailto:${BRAND.contact.privacy}`}>{BRAND.contact.privacy}</a>.
        </p>
      </section>

      <section>
        <h2>8. Cookie Policy</h2>
        <p>We use cookies to:</p>
        <ul>
          <li>Keep you logged in and remember your preferences</li>
          <li>Understand how you use our platform</li>
          <li>Improve our services based on usage patterns</li>
          <li>Provide personalized experiences</li>
        </ul>
        <p>
          You can manage cookie preferences through our consent banner or your browser settings. 
          Disabling cookies may affect some platform functionality.
        </p>
      </section>

      <section>
        <h2>9. California Privacy Rights (CCPA)</h2>
        <p>
          California residents have additional rights under the California Consumer Privacy Act (CCPA), 
          including the right to know what personal information we collect, the right to delete personal 
          information, and the right to opt-out of the sale of personal information.
        </p>
        <p>
          We do not sell personal information. To exercise your CCPA rights, contact us at{' '}
          <a href={`mailto:${BRAND.contact.privacy}`}>{BRAND.contact.privacy}</a>.
        </p>
      </section>

      <section>
        <h2>10. International Data Transfers</h2>
        <p>
          Your data may be processed in countries outside your residence. We ensure appropriate 
          safeguards are in place for such transfers, including standard contractual clauses and 
          adequacy decisions where applicable.
        </p>
      </section>

      <section>
        <h2>11. Children's Privacy</h2>
        <p>
          Our services are not intended for children under 18. We do not knowingly collect personal 
          information from children. If you believe we have collected such information, please contact us.
        </p>
      </section>

      <section>
        <h2>12. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy periodically. We will notify you of material changes by 
          posting the new policy on our website and updating the "Last Updated" date. Your continued 
          use of our services after changes constitutes acceptance of the updated policy.
        </p>
      </section>

      <section>
        <h2>13. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or our data practices, please contact us:
        </p>
        <ul>
          <li><strong>Email:</strong> <a href={`mailto:${BRAND.contact.privacy}`}>{BRAND.contact.privacy}</a></li>
          <li><strong>Website:</strong> <a href={BRAND.website}>{BRAND.website}</a></li>
        </ul>
      </section>
    </LegalPageLayout>
  );
};

export default Privacy;
