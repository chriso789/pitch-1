import { supabase } from '@/integrations/supabase/client';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import type {
  GenerationOptions,
  DocumentationResult,
  DocumentationStep,
  DocumentationMetadata,
  Asset,
  UploadResult,
} from '@/types/documentationGenerator';

class DocumentationGeneratorService {
  private metadata!: DocumentationMetadata;

  async generateDocumentation(options: GenerationOptions): Promise<DocumentationResult> {
    console.log('🚀 Starting documentation generation...');

    this.metadata = options.metadata;

    const result: DocumentationResult = {
      runId: options.runId,
      success: false,
      formats: {},
      assets: [],
      generatedAt: new Date(),
    };

    try {
      // Format steps with screenshots
      const documentationSteps: DocumentationStep[] = options.steps.map((step, index) => ({
        id: step.id,
        stepNumber: index + 1,
        title: step.title,
        description: step.description,
        narration: step.narration,
        action: step.action,
        screenshot: options.screenshots[step.id],
        duration: step.duration,
        captions: step.captions,
        timestamp: new Date().toISOString(),
      }));

      // Generate Markdown
      if (options.outputFormats.includes('markdown')) {
        const markdown = await this.generateMarkdown(documentationSteps);
        result.formats.markdown = { content: markdown };

        if (options.uploadToStorage) {
          const blob = new Blob([markdown], { type: 'text/markdown' });
          const assets = [
            {
              type: 'report' as const,
              data: blob,
              filename: 'documentation.md',
              mimeType: 'text/markdown',
            },
          ];
          const uploads = await this.uploadAssets(assets, options.runId);
          result.formats.markdown.storagePath = uploads[0].storagePath;
          result.formats.markdown.publicUrl = uploads[0].publicUrl;
          result.assets.push(uploads[0]);
        }
      }

      // Generate HTML
      if (options.outputFormats.includes('html')) {
        const html = await this.generateHTML(documentationSteps, options.metadata);
        result.formats.html = { content: html };

        if (options.uploadToStorage) {
          const blob = new Blob([html], { type: 'text/html' });
          const assets = [
            {
              type: 'report' as const,
              data: blob,
              filename: 'documentation.html',
              mimeType: 'text/html',
            },
          ];
          const uploads = await this.uploadAssets(assets, options.runId);
          result.formats.html.storagePath = uploads[0].storagePath;
          result.formats.html.publicUrl = uploads[0].publicUrl;
          result.assets.push(uploads[0]);
        }
      }

      // Generate PDF
      if (options.outputFormats.includes('pdf')) {
        const htmlForPdf =
          result.formats.html?.content ||
          (await this.generateHTML(documentationSteps, options.metadata));
        const pdfBlob = await this.generatePDF(htmlForPdf, options.metadata);
        result.formats.pdf = { blob: pdfBlob };

        if (options.uploadToStorage) {
          const assets = [
            {
              type: 'report' as const,
              data: pdfBlob,
              filename: 'documentation.pdf',
              mimeType: 'application/pdf',
            },
          ];
          const uploads = await this.uploadAssets(assets, options.runId);
          result.formats.pdf.storagePath = uploads[0].storagePath;
          result.formats.pdf.publicUrl = uploads[0].publicUrl;
          result.assets.push(uploads[0]);
        }
      }

      // Upload video if provided
      if (options.videoBlob && options.uploadToStorage) {
        const assets = [
          {
            type: 'video' as const,
            data: options.videoBlob,
            filename: 'walkthrough-recording.webm',
            mimeType: 'video/webm',
          },
        ];
        const uploads = await this.uploadAssets(assets, options.runId);
        result.assets.push(uploads[0]);
      }

      // Upload screenshots
      if (options.uploadToStorage && Object.keys(options.screenshots).length > 0) {
        const screenshotAssets: Asset[] = Object.entries(options.screenshots).map(
          ([stepId, dataUrl]) => ({
            type: 'screenshot' as const,
            stepId,
            data: this.dataURLtoBlob(dataUrl),
            filename: `${stepId}.png`,
            mimeType: 'image/png',
          })
        );
        const uploads = await this.uploadAssets(screenshotAssets, options.runId);
        result.assets.push(...uploads);
      }

      result.success = true;
      console.log('✅ Documentation generation completed successfully');
    } catch (error: any) {
      console.error('❌ Documentation generation failed:', error);
      result.success = false;
      result.error = error.message;
    }

    return result;
  }

  async generateMarkdown(steps: DocumentationStep[]): Promise<string> {
    let markdown = '';

    // Header
    markdown += `# ${this.metadata.title}\n\n`;
    markdown += `**Version:** ${this.metadata.version}  \n`;
    markdown += `**Generated:** ${this.metadata.generatedAt.toLocaleDateString()}  \n`;
    markdown += `**Generated By:** ${this.metadata.generatedBy}  \n\n`;

    if (this.metadata.description) {
      markdown += `${this.metadata.description}\n\n`;
    }

    markdown += `---\n\n`;

    // Table of Contents
    markdown += `## Table of Contents\n\n`;
    steps.forEach((step, index) => {
      markdown += `${index + 1}. [${step.title}](#${this.slugify(step.title)})\n`;
    });
    markdown += `\n---\n\n`;

    // Steps
    steps.forEach((step, index) => {
      markdown += `## ${index + 1}. ${step.title}\n\n`;
      markdown += `**Duration:** ${(step.duration / 1000).toFixed(1)}s  \n`;
      markdown += `**Action:** \`${step.action}\`\n\n`;

      // Description
      if (step.description) {
        markdown += `### Description\n\n${step.description}\n\n`;
      }

      // Screenshot
      if (step.screenshot) {
        markdown += `### Screenshot\n\n`;
        markdown += `![${step.title}](${step.screenshot})\n\n`;
      }

      // Narration
      if (step.narration) {
        markdown += `### Narration\n\n`;
        markdown += `> ${step.narration}\n\n`;
      }

      // Captions
      if (step.captions && step.captions.length > 0) {
        markdown += `### Key Points\n\n`;
        step.captions.forEach((caption) => {
          markdown += `- ${caption.text}\n`;
        });
        markdown += `\n`;
      }

      markdown += `---\n\n`;
    });

    // Footer
    markdown += `\n\n*Documentation generated by PITCH CRM Automated Documentation System*\n`;

    return markdown;
  }

  async generateHTML(steps: DocumentationStep[], metadata: DocumentationMetadata): Promise<string> {
    const tableOfContents = this.generateTableOfContents(steps);
    const stepsHTML = this.generateStepsHTML(steps);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${metadata.title}</title>
  <style>
    ${this.getDefaultStyles()}
    ${metadata.customStyles || ''}
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      ${metadata.companyLogo ? `<img src="${metadata.companyLogo}" alt="Logo" class="logo">` : ''}
      <h1>${metadata.title}</h1>
      <div class="metadata">
        <p><strong>Version:</strong> ${metadata.version}</p>
        <p><strong>Generated:</strong> ${metadata.generatedAt.toLocaleString()}</p>
        <p><strong>Generated By:</strong> ${metadata.generatedBy}</p>
      </div>
      ${metadata.description ? `<p class="description">${metadata.description}</p>` : ''}
    </header>
    
    <!-- Navigation Sidebar -->
    <nav class="sidebar">
      <h2>Navigation</h2>
      ${tableOfContents}
    </nav>
    
    <!-- Main Content -->
    <main class="content">
      ${stepsHTML}
    </main>
    
    <!-- Footer -->
    <footer class="footer">
      <p>Documentation generated by PITCH CRM Automated Documentation System</p>
      <p>${new Date().toLocaleDateString()}</p>
    </footer>
  </div>
  
  <script>
    // Smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
    
    // Highlight current section in navigation
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          document.querySelectorAll('.sidebar a').forEach(link => {
            link.classList.remove('active');
          });
          document.querySelector(\`.sidebar a[href="#\${id}"]\`)?.classList.add('active');
        }
      });
    }, { threshold: 0.5 });
    
    document.querySelectorAll('.step').forEach(step => observer.observe(step));
  </script>
</body>
</html>
    `;
  }

  async generatePDF(htmlContent: string, metadata: DocumentationMetadata): Promise<Blob> {
    console.log('📄 Generating PDF from HTML...');

    // Create a temporary container
    const container = document.createElement('div');
    container.innerHTML = htmlContent;
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.width = '210mm'; // A4 width
    document.body.appendChild(container);

    try {
      // Capture as canvas
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: 794, // A4 width in pixels at 96 DPI
      });

      // Create PDF
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const imgWidth = 210; // A4 width in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pageHeight = 297; // A4 height in mm

      let heightLeft = imgHeight;
      let position = 0;

      // Add first page
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Add additional pages if content is too tall
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Add metadata
      pdf.setProperties({
        title: metadata.title,
        subject: metadata.description || 'PITCH CRM Documentation',
        author: metadata.generatedBy,
        creator: 'PITCH CRM Documentation System',
        keywords: 'documentation, walkthrough, guide',
      });

      console.log('✅ PDF generated successfully');
      return pdf.output('blob');
    } finally {
      // Clean up
      document.body.removeChild(container);
    }
  }

  async uploadAssets(assets: Asset[], runId: string): Promise<UploadResult[]> {
    console.log(`📤 Uploading ${assets.length} assets to Supabase Storage...`);

    const results: UploadResult[] = [];

    for (const asset of assets) {
      try {
        const storagePath = this.generateStoragePath(runId, asset);
        const publicUrl = await this.uploadToStorage(asset.data, storagePath);

        results.push({
          assetType: asset.type,
          stepId: asset.stepId,
          storagePath,
          publicUrl,
          fileSize: asset.data instanceof Blob ? asset.data.size : new Blob([asset.data]).size,
        });

        console.log(`✅ Uploaded ${asset.filename} → ${storagePath}`);
      } catch (error) {
        console.error(`❌ Failed to upload ${asset.filename}:`, error);
        throw error;
      }
    }

    return results;
  }

  private generateStoragePath(runId: string, asset: Asset): string {
    const timestamp = new Date().toISOString().split('T')[0];

    switch (asset.type) {
      case 'screenshot':
        return `documentation/${runId}/screenshots/${asset.stepId}.png`;
      case 'video':
        return `documentation/${runId}/video/${timestamp}-recording.webm`;
      case 'report':
        const ext = asset.filename.split('.').pop();
        return `documentation/${runId}/reports/${timestamp}-report.${ext}`;
      default:
        return `documentation/${runId}/misc/${asset.filename}`;
    }
  }

  async uploadToStorage(data: Blob | string, path: string): Promise<string> {
    const blob = data instanceof Blob ? data : new Blob([data]);

    const { data: uploadData, error } = await supabase.storage
      .from('documentation-assets')
      .upload(path, blob, {
        cacheControl: '3600',
        upsert: true,
      });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from('documentation-assets').getPublicUrl(path);

    return urlData.publicUrl;
  }

  private generateTableOfContents(steps: DocumentationStep[]): string {
    return `
      <ul>
        ${steps
          .map(
            (step) => `
          <li>
            <a href="#step-${step.id}">
              ${step.stepNumber}. ${step.title}
            </a>
          </li>
        `
          )
          .join('')}
      </ul>
    `;
  }

  private generateStepsHTML(steps: DocumentationStep[]): string {
    return steps
      .map(
        (step, index) => `
    <section class="step" id="step-${step.id}">
      <div class="step-header">
        <span class="step-number">Step ${index + 1}</span>
        <h2>${step.title}</h2>
        <span class="duration">${(step.duration / 1000).toFixed(1)}s</span>
      </div>
      
      ${
        step.screenshot
          ? `
        <div class="screenshot">
          <img src="${step.screenshot}" alt="${step.title}" loading="lazy">
        </div>
      `
          : ''
      }
      
      <div class="step-content">
        ${step.description ? `<p class="description">${step.description}</p>` : ''}
        
        ${
          step.narration
            ? `
          <div class="narration">
            <h3>📢 Narration</h3>
            <p>${step.narration}</p>
          </div>
        `
            : ''
        }
        
        <div class="action">
          <h3>⚡ Action</h3>
          <code>${step.action}</code>
        </div>
        
        ${
          step.captions && step.captions.length > 0
            ? `
          <div class="key-points">
            <h3>🔑 Key Points</h3>
            <ul>
              ${step.captions.map((caption) => `<li>${caption.text}</li>`).join('')}
            </ul>
          </div>
        `
            : ''
        }
      </div>
    </section>
  `
      )
      .join('\n');
  }

  private getDefaultStyles(): string {
    return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
    }
    
    .container {
      display: grid;
      grid-template-columns: 280px 1fr;
      grid-template-rows: auto 1fr auto;
      min-height: 100vh;
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      box-shadow: 0 0 40px rgba(0,0,0,0.1);
    }
    
    .header {
      grid-column: 1 / -1;
      padding: 2rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
    }
    
    .logo { max-width: 200px; margin-bottom: 1rem; }
    .header h1 { font-size: 2.5rem; margin-bottom: 1rem; }
    .metadata { display: flex; gap: 2rem; justify-content: center; margin-top: 1rem; }
    .description { margin-top: 1rem; font-size: 1.1rem; opacity: 0.9; }
    
    .sidebar {
      padding: 2rem 1rem;
      background: #f8f9fa;
      border-right: 1px solid #dee2e6;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    
    .sidebar h2 { margin-bottom: 1rem; font-size: 1.2rem; }
    .sidebar ul { list-style: none; }
    .sidebar li { margin-bottom: 0.5rem; }
    .sidebar a {
      display: block;
      padding: 0.5rem 1rem;
      color: #495057;
      text-decoration: none;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .sidebar a:hover { background: #e9ecef; color: #667eea; }
    .sidebar a.active { background: #667eea; color: white; font-weight: 600; }
    
    .content { padding: 2rem; }
    
    .step {
      margin-bottom: 3rem;
      padding: 2rem;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .step-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 2px solid #e9ecef;
    }
    
    .step-number {
      background: #667eea;
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-weight: 600;
      font-size: 0.9rem;
    }
    
    .step-header h2 { flex: 1; font-size: 1.8rem; color: #2c3e50; }
    .duration {
      background: #e9ecef;
      padding: 0.25rem 0.75rem;
      border-radius: 4px;
      font-size: 0.9rem;
      color: #495057;
    }
    
    .screenshot {
      margin: 1.5rem 0;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    .screenshot img {
      width: 100%;
      height: auto;
      display: block;
    }
    
    .step-content { margin-top: 1.5rem; }
    .step-content > div { margin-bottom: 1.5rem; }
    .step-content h3 {
      font-size: 1.2rem;
      margin-bottom: 0.75rem;
      color: #495057;
    }
    
    .narration {
      background: #f8f9fa;
      padding: 1rem;
      border-left: 4px solid #667eea;
      border-radius: 4px;
    }
    
    .action code {
      display: block;
      background: #2c3e50;
      color: #ecf0f1;
      padding: 1rem;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.95rem;
    }
    
    .key-points ul {
      list-style-position: inside;
      padding-left: 1rem;
    }
    
    .key-points li {
      padding: 0.5rem 0;
      border-bottom: 1px solid #f1f3f5;
    }
    
    .key-points li:last-child { border-bottom: none; }
    
    .footer {
      grid-column: 1 / -1;
      padding: 2rem;
      background: #2c3e50;
      color: white;
      text-align: center;
    }
    
    @media print {
      .sidebar { display: none; }
      .container { grid-template-columns: 1fr; }
      .step { page-break-inside: avoid; }
    }
    
    @media (max-width: 768px) {
      .container { grid-template-columns: 1fr; }
      .sidebar { display: none; }
    }
  `;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/--+/g, '-')
      .trim();
  }

  private dataURLtoBlob(dataURL: string): Blob {
    const arr = dataURL.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }
}

export const documentationGenerator = new DocumentationGeneratorService();
