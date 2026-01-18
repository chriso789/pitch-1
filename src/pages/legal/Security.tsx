import React from 'react';
import LegalPageLayout from '@/components/legal/LegalPageLayout';
import { BRAND } from '@/lib/branding/legal';

const Security = () => {
  return (
    <LegalPageLayout title="Security Policy" lastUpdated="January 18, 2025">
      <section>
        <h2>1. Our Commitment to Security</h2>
        <p>
          At {BRAND.name}, we take the security of your data seriously. As a platform that handles 
          sensitive business and customer information, we implement comprehensive security measures 
          to protect your data from unauthorized access, disclosure, alteration, or destruction.
        </p>
        <p>
          This Security Policy outlines our security practices, infrastructure, and your responsibilities 
          in maintaining the security of your account.
        </p>
      </section>

      <section>
        <h2>2. Infrastructure Security</h2>
        <h3>2.1 Cloud Infrastructure</h3>
        <ul>
          <li><strong>Hosting:</strong> Our services are hosted on enterprise-grade cloud infrastructure with SOC 2 Type II compliance</li>
          <li><strong>Data Centers:</strong> Located in secure, geographically distributed facilities with 24/7 physical security</li>
          <li><strong>Redundancy:</strong> Multiple availability zones ensure high availability and disaster recovery</li>
          <li><strong>Backups:</strong> Automated daily backups with point-in-time recovery capabilities</li>
        </ul>

        <h3>2.2 Network Security</h3>
        <ul>
          <li><strong>Firewalls:</strong> Enterprise-grade firewalls protect all network boundaries</li>
          <li><strong>DDoS Protection:</strong> Distributed denial-of-service mitigation is enabled</li>
          <li><strong>Intrusion Detection:</strong> Continuous monitoring for suspicious network activity</li>
          <li><strong>VPN:</strong> Secure VPN access for administrative operations</li>
        </ul>
      </section>

      <section>
        <h2>3. Data Encryption</h2>
        <h3>3.1 Encryption in Transit</h3>
        <p>
          All data transmitted between your device and our servers is encrypted using TLS 1.3 
          (Transport Layer Security). This includes all API calls, web traffic, and file transfers.
        </p>

        <h3>3.2 Encryption at Rest</h3>
        <p>
          All data stored in our databases and file storage is encrypted using AES-256 encryption. 
          Encryption keys are managed using industry-standard key management practices.
        </p>

        <h3>3.3 Additional Encryption</h3>
        <ul>
          <li>Passwords are hashed using bcrypt with salt</li>
          <li>Sensitive fields (payment data, API keys) receive additional application-level encryption</li>
          <li>Call recordings and attachments are encrypted at rest</li>
        </ul>
      </section>

      <section>
        <h2>4. Access Controls</h2>
        <h3>4.1 Authentication</h3>
        <ul>
          <li><strong>Strong Passwords:</strong> We enforce minimum password complexity requirements</li>
          <li><strong>Session Management:</strong> Secure session tokens with automatic expiration</li>
          <li><strong>Multi-Factor Authentication:</strong> Optional 2FA available for all accounts</li>
          <li><strong>SSO:</strong> Enterprise Single Sign-On integration available</li>
        </ul>

        <h3>4.2 Authorization</h3>
        <ul>
          <li><strong>Role-Based Access Control:</strong> Granular permissions based on user roles</li>
          <li><strong>Row-Level Security:</strong> Database-enforced tenant isolation</li>
          <li><strong>Principle of Least Privilege:</strong> Users only access data they need</li>
          <li><strong>Audit Logging:</strong> All access to sensitive data is logged</li>
        </ul>
      </section>

      <section>
        <h2>5. Application Security</h2>
        <h3>5.1 Secure Development</h3>
        <ul>
          <li><strong>Code Review:</strong> All code changes undergo peer review</li>
          <li><strong>Static Analysis:</strong> Automated security scanning of codebase</li>
          <li><strong>Dependency Scanning:</strong> Regular updates and vulnerability checks for dependencies</li>
          <li><strong>OWASP Compliance:</strong> Development follows OWASP security guidelines</li>
        </ul>

        <h3>5.2 Security Testing</h3>
        <ul>
          <li><strong>Penetration Testing:</strong> Regular third-party security assessments</li>
          <li><strong>Vulnerability Scanning:</strong> Continuous automated vulnerability scanning</li>
          <li><strong>Bug Bounty:</strong> We maintain a responsible disclosure program</li>
        </ul>
      </section>

      <section>
        <h2>6. Compliance</h2>
        <p>We maintain compliance with applicable regulations and standards:</p>
        <ul>
          <li><strong>TCPA:</strong> Telephone Consumer Protection Act compliance for calling/SMS features</li>
          <li><strong>CAN-SPAM:</strong> Email communication compliance</li>
          <li><strong>GDPR:</strong> General Data Protection Regulation compliance for EU users</li>
          <li><strong>CCPA:</strong> California Consumer Privacy Act compliance</li>
          <li><strong>PCI DSS:</strong> Payment card data handled through PCI-compliant processor (Stripe)</li>
        </ul>
      </section>

      <section>
        <h2>7. Incident Response</h2>
        <h3>7.1 Detection and Response</h3>
        <p>
          We maintain a comprehensive incident response plan that includes:
        </p>
        <ul>
          <li>24/7 security monitoring and alerting</li>
          <li>Defined escalation procedures</li>
          <li>Rapid incident containment protocols</li>
          <li>Post-incident analysis and improvement</li>
        </ul>

        <h3>7.2 Breach Notification</h3>
        <p>
          In the event of a security breach affecting your data, we will notify you in accordance 
          with applicable laws, typically within 72 hours of discovery.
        </p>
      </section>

      <section>
        <h2>8. Employee Security</h2>
        <ul>
          <li><strong>Background Checks:</strong> All employees undergo background screening</li>
          <li><strong>Security Training:</strong> Regular security awareness training for all staff</li>
          <li><strong>Access Reviews:</strong> Periodic review of employee access privileges</li>
          <li><strong>Confidentiality:</strong> Employees sign confidentiality agreements</li>
          <li><strong>Device Security:</strong> Company devices have security policies enforced</li>
        </ul>
      </section>

      <section>
        <h2>9. Third-Party Security</h2>
        <p>
          We carefully evaluate the security practices of our vendors and partners:
        </p>
        <ul>
          <li><strong>Vendor Assessment:</strong> Security review before engaging vendors</li>
          <li><strong>Contractual Requirements:</strong> Data protection clauses in vendor agreements</li>
          <li><strong>Ongoing Monitoring:</strong> Regular review of vendor security posture</li>
        </ul>
        
        <h3>9.1 Key Third-Party Services</h3>
        <ul>
          <li><strong>Supabase:</strong> SOC 2 Type II certified database provider</li>
          <li><strong>Stripe:</strong> PCI DSS Level 1 certified payment processor</li>
          <li><strong>Telnyx:</strong> SOC 2 Type II certified communications provider</li>
        </ul>
      </section>

      <section>
        <h2>10. Your Security Responsibilities</h2>
        <p>
          Security is a shared responsibility. We recommend that you:
        </p>
        <ul>
          <li>Use strong, unique passwords and enable multi-factor authentication</li>
          <li>Keep your account credentials confidential</li>
          <li>Log out of your account when using shared devices</li>
          <li>Report any suspicious activity immediately</li>
          <li>Keep your devices and browsers updated</li>
          <li>Be cautious of phishing attempts and verify email authenticity</li>
          <li>Regularly review user access within your organization</li>
        </ul>
      </section>

      <section>
        <h2>11. Data Retention and Disposal</h2>
        <p>
          We retain data only as long as necessary for business and legal purposes:
        </p>
        <ul>
          <li>Active account data is retained while the account is active</li>
          <li>Deleted data is removed from active systems within 30 days</li>
          <li>Backups are retained for 90 days then securely destroyed</li>
          <li>You may request data deletion at any time</li>
        </ul>
      </section>

      <section>
        <h2>12. Security Updates</h2>
        <p>
          We continuously improve our security practices. This policy is reviewed and updated 
          regularly to reflect changes in our security posture, emerging threats, and regulatory requirements.
        </p>
      </section>

      <section>
        <h2>13. Reporting Security Issues</h2>
        <p>
          If you discover a security vulnerability or have security concerns, please report them 
          responsibly to:
        </p>
        <ul>
          <li><strong>Email:</strong> <a href={`mailto:${BRAND.contact.support}`}>{BRAND.contact.support}</a></li>
          <li><strong>Subject Line:</strong> "Security Vulnerability Report"</li>
        </ul>
        <p>
          We appreciate responsible disclosure and will work with you to address any legitimate 
          security concerns promptly.
        </p>
      </section>

      <section>
        <h2>14. Contact Information</h2>
        <p>For security-related questions, please contact us:</p>
        <ul>
          <li><strong>Email:</strong> <a href={`mailto:${BRAND.contact.support}`}>{BRAND.contact.support}</a></li>
          <li><strong>Website:</strong> <a href={BRAND.website}>{BRAND.website}</a></li>
        </ul>
      </section>
    </LegalPageLayout>
  );
};

export default Security;
