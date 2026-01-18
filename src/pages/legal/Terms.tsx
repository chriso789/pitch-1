import React from 'react';
import LegalPageLayout from '@/components/legal/LegalPageLayout';
import { BRAND } from '@/lib/branding/legal';

const Terms = () => {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated="January 18, 2025">
      <section>
        <h2>1. Agreement to Terms</h2>
        <p>
          By accessing or using {BRAND.name} (the "Service"), you agree to be bound by these Terms of Service 
          ("Terms"). If you disagree with any part of these Terms, you may not access the Service.
        </p>
        <p>
          These Terms constitute a legally binding agreement between you and {BRAND.company} ("Company," "we," 
          "us," or "our") regarding your use of the Service.
        </p>
      </section>

      <section>
        <h2>2. Description of Service</h2>
        <p>
          {BRAND.name} is an AI-powered customer relationship management (CRM) platform designed specifically 
          for construction, roofing, and home improvement businesses. The Service includes features such as:
        </p>
        <ul>
          <li>Contact and lead management</li>
          <li>Project and job tracking</li>
          <li>Estimate and proposal generation</li>
          <li>AI-powered measurement and analysis tools</li>
          <li>Communication tools (calling, SMS, email)</li>
          <li>Territory and canvassing management</li>
          <li>Integration with third-party services</li>
        </ul>
      </section>

      <section>
        <h2>3. Account Registration</h2>
        <h3>3.1 Account Creation</h3>
        <p>
          To use the Service, you must register for an account. You agree to provide accurate, current, 
          and complete information during registration and to update such information to keep it accurate.
        </p>

        <h3>3.2 Account Security</h3>
        <p>
          You are responsible for safeguarding your account credentials and for all activities that occur 
          under your account. You must notify us immediately of any unauthorized use of your account.
        </p>

        <h3>3.3 Account Requirements</h3>
        <ul>
          <li>You must be at least 18 years old to use the Service</li>
          <li>You must provide a valid email address and phone number</li>
          <li>You must not share your account credentials with others</li>
          <li>Each user must have their own individual account</li>
        </ul>
      </section>

      <section>
        <h2>4. Subscription and Payment</h2>
        <h3>4.1 Subscription Plans</h3>
        <p>
          The Service is offered through various subscription plans. Details of each plan, including features 
          and pricing, are available on our pricing page. We reserve the right to modify plans and pricing 
          with reasonable notice.
        </p>

        <h3>4.2 Payment Terms</h3>
        <ul>
          <li>Subscription fees are billed in advance on a monthly or annual basis</li>
          <li>All fees are non-refundable except as expressly stated in these Terms</li>
          <li>You authorize us to charge your payment method for all applicable fees</li>
          <li>Failed payments may result in suspension or termination of your account</li>
        </ul>

        <h3>4.3 Free Trials</h3>
        <p>
          We may offer free trial periods. At the end of a trial, your subscription will automatically 
          convert to a paid subscription unless you cancel before the trial ends.
        </p>

        <h3>4.4 Usage-Based Charges</h3>
        <p>
          Certain features may incur usage-based charges (e.g., AI usage, phone minutes, SMS messages). 
          These charges are in addition to your subscription fee and are billed according to your usage.
        </p>
      </section>

      <section>
        <h2>5. Acceptable Use</h2>
        <h3>5.1 Permitted Uses</h3>
        <p>
          You may use the Service only for lawful business purposes in accordance with these Terms.
        </p>

        <h3>5.2 Prohibited Activities</h3>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose or in violation of any laws</li>
          <li>Upload or transmit viruses, malware, or other harmful code</li>
          <li>Attempt to gain unauthorized access to any part of the Service</li>
          <li>Interfere with or disrupt the Service or its infrastructure</li>
          <li>Use the Service to harass, abuse, or harm others</li>
          <li>Send spam or unsolicited communications through our platform</li>
          <li>Scrape, crawl, or use automated means to access the Service without permission</li>
          <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
          <li>Resell or redistribute the Service without authorization</li>
          <li>Use the Service in any way that violates the TCPA, CAN-SPAM, or other regulations</li>
        </ul>
      </section>

      <section>
        <h2>6. Intellectual Property</h2>
        <h3>6.1 Our Intellectual Property</h3>
        <p>
          The Service, including its content, features, and functionality, is owned by {BRAND.company} and 
          is protected by copyright, trademark, and other intellectual property laws. {BRAND.shortName} and 
          {BRAND.name} are trademarks of {BRAND.company}.
        </p>

        <h3>6.2 Your Content</h3>
        <p>
          You retain ownership of the content you upload to the Service ("Your Content"). By uploading 
          content, you grant us a limited license to host, store, and display Your Content as necessary 
          to provide the Service.
        </p>

        <h3>6.3 Feedback</h3>
        <p>
          If you provide feedback or suggestions about the Service, we may use this feedback without 
          obligation to you.
        </p>
      </section>

      <section>
        <h2>7. Data and Privacy</h2>
        <p>
          Our collection and use of personal information is governed by our <a href="/legal/privacy">Privacy Policy</a>. 
          By using the Service, you consent to the collection and use of information as described in our Privacy Policy.
        </p>
        <p>
          You are responsible for ensuring that your use of the Service complies with applicable privacy 
          and data protection laws, including obtaining necessary consents from your customers.
        </p>
      </section>

      <section>
        <h2>8. Third-Party Services</h2>
        <p>
          The Service may integrate with third-party services (e.g., Google Calendar, QuickBooks, Stripe). 
          Your use of these services is subject to their respective terms and policies. We are not 
          responsible for third-party services.
        </p>
      </section>

      <section>
        <h2>9. Disclaimers</h2>
        <h3>9.1 "As Is" Basis</h3>
        <p>
          THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR 
          IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND 
          NON-INFRINGEMENT.
        </p>

        <h3>9.2 AI Features</h3>
        <p>
          AI-generated content and measurements are provided for informational purposes and should be 
          verified by qualified professionals. We do not guarantee the accuracy of AI-generated content.
        </p>

        <h3>9.3 No Professional Advice</h3>
        <p>
          The Service does not constitute legal, financial, or professional advice. You should consult 
          appropriate professionals for such matters.
        </p>
      </section>

      <section>
        <h2>10. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, {BRAND.company.toUpperCase()} SHALL NOT BE LIABLE FOR ANY 
          INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, 
          DATA, OR BUSINESS OPPORTUNITIES, ARISING FROM YOUR USE OF THE SERVICE.
        </p>
        <p>
          OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT YOU PAID FOR THE SERVICE IN THE TWELVE (12) 
          MONTHS PRECEDING THE CLAIM.
        </p>
      </section>

      <section>
        <h2>11. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless {BRAND.company}, its officers, directors, employees, and 
          agents from any claims, damages, losses, or expenses (including legal fees) arising from your 
          use of the Service, your violation of these Terms, or your violation of any third-party rights.
        </p>
      </section>

      <section>
        <h2>12. Termination</h2>
        <h3>12.1 Termination by You</h3>
        <p>
          You may terminate your account at any time through your account settings or by contacting support. 
          Termination will be effective at the end of your current billing period.
        </p>

        <h3>12.2 Termination by Us</h3>
        <p>
          We may suspend or terminate your account immediately if you violate these Terms or engage in 
          conduct that we determine is harmful to the Service, other users, or us.
        </p>

        <h3>12.3 Effect of Termination</h3>
        <p>
          Upon termination, your right to use the Service will cease immediately. We may delete your 
          data after termination in accordance with our data retention policies.
        </p>
      </section>

      <section>
        <h2>13. Changes to Terms</h2>
        <p>
          We may modify these Terms at any time. We will provide notice of material changes by posting 
          the updated Terms on our website and updating the "Last Updated" date. Your continued use of 
          the Service after changes constitutes acceptance of the modified Terms.
        </p>
      </section>

      <section>
        <h2>14. Dispute Resolution</h2>
        <h3>14.1 Governing Law</h3>
        <p>
          These Terms shall be governed by the laws of the State of Delaware, without regard to conflict 
          of law principles.
        </p>

        <h3>14.2 Arbitration</h3>
        <p>
          Any disputes arising from these Terms or the Service shall be resolved through binding 
          arbitration in accordance with the rules of the American Arbitration Association.
        </p>

        <h3>14.3 Class Action Waiver</h3>
        <p>
          You agree to resolve disputes with us on an individual basis and waive any right to participate 
          in class action lawsuits.
        </p>
      </section>

      <section>
        <h2>15. General Provisions</h2>
        <ul>
          <li><strong>Entire Agreement:</strong> These Terms constitute the entire agreement between you and us regarding the Service.</li>
          <li><strong>Severability:</strong> If any provision is found unenforceable, the remaining provisions remain in effect.</li>
          <li><strong>Waiver:</strong> Failure to enforce any provision does not constitute a waiver of that provision.</li>
          <li><strong>Assignment:</strong> You may not assign these Terms without our consent. We may assign our rights freely.</li>
        </ul>
      </section>

      <section>
        <h2>16. Contact Information</h2>
        <p>For questions about these Terms, please contact us:</p>
        <ul>
          <li><strong>Email:</strong> <a href={`mailto:${BRAND.contact.legal}`}>{BRAND.contact.legal}</a></li>
          <li><strong>Website:</strong> <a href={BRAND.website}>{BRAND.website}</a></li>
        </ul>
      </section>
    </LegalPageLayout>
  );
};

export default Terms;
