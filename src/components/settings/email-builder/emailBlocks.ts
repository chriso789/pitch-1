// Email Block Library - 16 professional block types
export interface EmailBlock {
  id: string;
  type: string;
  name: string;
  icon: string;
  category: 'layout' | 'content' | 'feature' | 'special';
  defaultProps: Record<string, any>;
  html: (props: Record<string, any>) => string;
}

export const EMAIL_BLOCKS: Record<string, EmailBlock> = {
  // Layout Blocks
  header: {
    id: 'header',
    type: 'header',
    name: 'Header',
    icon: 'Layout',
    category: 'layout',
    defaultProps: {
      title: 'Email Title',
      bgColor: '#1e3a5f',
      bgGradient: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)',
      textColor: '#ffffff',
    },
    html: (props) => `
      <tr>
        <td style="background: ${props.bgGradient || props.bgColor}; padding: 40px 30px; text-align: center;">
          <h1 style="color: ${props.textColor}; margin: 0; font-size: 28px; font-weight: 700;">${props.title}</h1>
        </td>
      </tr>
    `,
  },
  
  footer: {
    id: 'footer',
    type: 'footer',
    name: 'Footer',
    icon: 'LayoutGrid',
    category: 'layout',
    defaultProps: {
      companyName: 'PITCH CRM',
      year: '2025',
      bgColor: '#f8fafc',
    },
    html: (props) => `
      <tr>
        <td style="background-color: ${props.bgColor}; padding: 25px 30px; text-align: center;">
          <p style="color: #94a3b8; margin: 0; font-size: 13px;">© ${props.year} ${props.companyName}</p>
        </td>
      </tr>
    `,
  },

  divider: {
    id: 'divider',
    type: 'divider',
    name: 'Divider',
    icon: 'Minus',
    category: 'layout',
    defaultProps: { color: '#e2e8f0', thickness: '1' },
    html: (props) => `
      <tr>
        <td style="padding: 20px 30px;">
          <hr style="border: none; height: ${props.thickness}px; background-color: ${props.color}; margin: 0;" />
        </td>
      </tr>
    `,
  },

  spacer: {
    id: 'spacer',
    type: 'spacer',
    name: 'Spacer',
    icon: 'Square',
    category: 'layout',
    defaultProps: { height: '30' },
    html: (props) => `
      <tr>
        <td style="height: ${props.height}px;"></td>
      </tr>
    `,
  },

  // Content Blocks
  text: {
    id: 'text',
    type: 'text',
    name: 'Text Block',
    icon: 'Type',
    category: 'content',
    defaultProps: {
      content: 'Enter your text here...',
      color: '#475569',
      fontSize: '16',
    },
    html: (props) => `
      <tr>
        <td style="padding: 0 30px 20px;">
          <p style="color: ${props.color}; line-height: 1.8; font-size: ${props.fontSize}px; margin: 0;">${props.content}</p>
        </td>
      </tr>
    `,
  },

  heading: {
    id: 'heading',
    type: 'heading',
    name: 'Heading',
    icon: 'Heading',
    category: 'content',
    defaultProps: {
      text: 'Section Heading',
      level: 'h2',
      color: '#1e3a5f',
    },
    html: (props) => `
      <tr>
        <td style="padding: 20px 30px 10px;">
          <${props.level} style="color: ${props.color}; margin: 0; font-size: ${props.level === 'h2' ? '22' : '18'}px;">${props.text}</${props.level}>
        </td>
      </tr>
    `,
  },

  image: {
    id: 'image',
    type: 'image',
    name: 'Image',
    icon: 'Image',
    category: 'content',
    defaultProps: {
      src: 'https://via.placeholder.com/560x200',
      alt: 'Image',
      width: '100%',
    },
    html: (props) => `
      <tr>
        <td style="padding: 20px 30px;">
          <img src="${props.src}" alt="${props.alt}" style="max-width: ${props.width}; height: auto; display: block; border-radius: 8px;" />
        </td>
      </tr>
    `,
  },

  button: {
    id: 'button',
    type: 'button',
    name: 'CTA Button',
    icon: 'MousePointer',
    category: 'content',
    defaultProps: {
      text: 'Click Here',
      url: '{{action_url}}',
      bgColor: '#1e3a5f',
      textColor: '#ffffff',
      bgGradient: 'linear-gradient(135deg, #1e3a5f, #2d5a87)',
    },
    html: (props) => `
      <tr>
        <td style="padding: 20px 30px; text-align: center;">
          <a href="${props.url}" style="display: inline-block; background: ${props.bgGradient || props.bgColor}; color: ${props.textColor}; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">${props.text}</a>
        </td>
      </tr>
    `,
  },

  // Feature Blocks
  featureList: {
    id: 'featureList',
    type: 'featureList',
    name: 'Feature List',
    icon: 'ListChecks',
    category: 'feature',
    defaultProps: {
      features: [
        { icon: '✅', title: 'Feature One', description: 'Description of the first feature' },
        { icon: '✅', title: 'Feature Two', description: 'Description of the second feature' },
        { icon: '✅', title: 'Feature Three', description: 'Description of the third feature' },
      ],
    },
    html: (props) => `
      <tr>
        <td style="padding: 20px 30px;">
          ${props.features.map((f: any) => `
            <table width="100%" style="margin-bottom: 15px;">
              <tr>
                <td width="40" valign="top" style="font-size: 20px;">${f.icon}</td>
                <td>
                  <p style="margin: 0 0 5px; color: #1e3a5f; font-weight: 600;">${f.title}</p>
                  <p style="margin: 0; color: #64748b; font-size: 14px;">${f.description}</p>
                </td>
              </tr>
            </table>
          `).join('')}
        </td>
      </tr>
    `,
  },

  iconGrid: {
    id: 'iconGrid',
    type: 'iconGrid',
    name: 'Icon Grid',
    icon: 'Grid',
    category: 'feature',
    defaultProps: {
      items: [
        { icon: '📊', label: 'Analytics' },
        { icon: '📞', label: 'Power Dialer' },
        { icon: '📐', label: 'Measurements' },
        { icon: '💰', label: 'Estimates' },
      ],
    },
    html: (props) => `
      <tr>
        <td style="padding: 20px 30px;">
          <table width="100%">
            <tr>
              ${props.items.map((item: any) => `
                <td style="text-align: center; padding: 15px;">
                  <span style="font-size: 32px; display: block;">${item.icon}</span>
                  <p style="margin: 10px 0 0; color: #475569; font-size: 14px;">${item.label}</p>
                </td>
              `).join('')}
            </tr>
          </table>
        </td>
      </tr>
    `,
  },

  testimonial: {
    id: 'testimonial',
    type: 'testimonial',
    name: 'Testimonial',
    icon: 'Quote',
    category: 'feature',
    defaultProps: {
      quote: 'PITCH CRM has transformed how we manage our roofing business. Highly recommended!',
      author: 'John Smith',
      company: 'ABC Roofing Co.',
      accentColor: '#d4af37',
    },
    html: (props) => `
      <tr>
        <td style="padding: 30px; background: #f8fafc;">
          <table width="100%">
            <tr>
              <td style="border-left: 4px solid ${props.accentColor}; padding-left: 20px;">
                <p style="font-style: italic; color: #475569; font-size: 16px; line-height: 1.6; margin: 0;">"${props.quote}"</p>
                <p style="margin: 15px 0 0; font-weight: 600; color: #1e3a5f;">— ${props.author}, ${props.company}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `,
  },

  socialLinks: {
    id: 'socialLinks',
    type: 'socialLinks',
    name: 'Social Links',
    icon: 'Share2',
    category: 'feature',
    defaultProps: {
      links: [
        { platform: 'facebook', url: '#' },
        { platform: 'twitter', url: '#' },
        { platform: 'linkedin', url: '#' },
      ],
    },
    html: (props) => `
      <tr>
        <td style="padding: 20px 30px; text-align: center;">
          ${props.links.map((link: any) => `
            <a href="${link.url}" style="display: inline-block; margin: 0 8px; color: #64748b; text-decoration: none; font-size: 14px;">${link.platform}</a>
          `).join(' | ')}
        </td>
      </tr>
    `,
  },

  // Special Blocks
  hero: {
    id: 'hero',
    type: 'hero',
    name: 'Hero Section',
    icon: 'Sparkles',
    category: 'special',
    defaultProps: {
      heading: 'Welcome to PITCH CRM',
      subheading: 'The all-in-one solution for roofing contractors',
      buttonText: 'Get Started',
      buttonUrl: '{{action_url}}',
      bgGradient: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)',
    },
    html: (props) => `
      <tr>
        <td style="background: ${props.bgGradient}; padding: 60px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 32px; font-weight: 700;">${props.heading}</h1>
          <p style="color: #e2e8f0; margin: 20px 0 30px; font-size: 18px;">${props.subheading}</p>
          <a href="${props.buttonUrl}" style="display: inline-block; background: #d4af37; color: #1e3a5f; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 16px;">${props.buttonText}</a>
        </td>
      </tr>
    `,
  },

  twoColumn: {
    id: 'twoColumn',
    type: 'twoColumn',
    name: 'Two Column',
    icon: 'Columns',
    category: 'special',
    defaultProps: {
      leftContent: 'Left column content goes here.',
      rightContent: 'Right column content goes here.',
    },
    html: (props) => `
      <tr>
        <td style="padding: 20px 30px;">
          <table width="100%">
            <tr>
              <td width="48%" valign="top" style="padding-right: 15px;">
                <p style="color: #475569; line-height: 1.6; margin: 0;">${props.leftContent}</p>
              </td>
              <td width="4%"></td>
              <td width="48%" valign="top" style="padding-left: 15px;">
                <p style="color: #475569; line-height: 1.6; margin: 0;">${props.rightContent}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `,
  },

  stats: {
    id: 'stats',
    type: 'stats',
    name: 'Stats Bar',
    icon: 'BarChart',
    category: 'special',
    defaultProps: {
      stats: [
        { value: '$46K+', label: 'Savings' },
        { value: '10x', label: 'Faster' },
        { value: '99.9%', label: 'Uptime' },
      ],
      bgColor: '#f0f9ff',
      accentColor: '#0369a1',
    },
    html: (props) => `
      <tr>
        <td style="padding: 20px 30px;">
          <table width="100%" style="background: ${props.bgColor}; border-radius: 12px;">
            <tr>
              ${props.stats.map((stat: any) => `
                <td style="text-align: center; padding: 25px;">
                  <p style="color: ${props.accentColor}; font-size: 28px; font-weight: 700; margin: 0;">${stat.value}</p>
                  <p style="color: #64748b; font-size: 12px; margin: 8px 0 0; text-transform: uppercase; letter-spacing: 1px;">${stat.label}</p>
                </td>
              `).join('')}
            </tr>
          </table>
        </td>
      </tr>
    `,
  },

  alert: {
    id: 'alert',
    type: 'alert',
    name: 'Alert Box',
    icon: 'AlertTriangle',
    category: 'special',
    defaultProps: {
      type: 'info',
      title: 'Important Notice',
      message: 'This is an important message for your attention.',
    },
    html: (props) => {
      const colors: Record<string, { bg: string; border: string; text: string }> = {
        info: { bg: '#f0f9ff', border: '#0ea5e9', text: '#0369a1' },
        warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
        error: { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c' },
        success: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
      };
      const c = colors[props.type] || colors.info;
      return `
        <tr>
          <td style="padding: 20px 30px;">
            <div style="background: ${c.bg}; border-left: 4px solid ${c.border}; padding: 20px; border-radius: 0 8px 8px 0;">
              <p style="margin: 0 0 8px; color: ${c.text}; font-weight: 600;">${props.title}</p>
              <p style="margin: 0; color: ${c.text}; font-size: 14px;">${props.message}</p>
            </div>
          </td>
        </tr>
      `;
    },
  },
};

export const BLOCK_CATEGORIES = [
  { id: 'layout', name: 'Layout', icon: 'Layout' },
  { id: 'content', name: 'Content', icon: 'Type' },
  { id: 'feature', name: 'Features', icon: 'ListChecks' },
  { id: 'special', name: 'Special', icon: 'Sparkles' },
];

export const generateEmailHtml = (blocks: { type: string; props: Record<string, any> }[]): string => {
  const blockHtml = blocks.map(block => {
    const blockDef = EMAIL_BLOCKS[block.type];
    if (!blockDef) return '';
    return blockDef.html(block.props);
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          ${blockHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
