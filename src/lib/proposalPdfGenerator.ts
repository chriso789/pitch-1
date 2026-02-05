import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export interface ProposalPdfOptions {
  filename?: string;
  pageSize?: "letter" | "a4";
  margin?: number;
}

/**
 * Convert proposal HTML content to a PDF blob
 */
export async function generateProposalPdf(
  htmlContent: string,
  options: ProposalPdfOptions = {}
): Promise<Blob> {
  const {
    pageSize = "letter",
    margin = 0,
  } = options;

  // Page dimensions in points
  const pageSizes = {
    letter: { width: 612, height: 792 },
    a4: { width: 595, height: 842 },
  };

  const { width: pageWidth, height: pageHeight } = pageSizes[pageSize];
  const contentWidth = pageWidth - margin * 2;

  // Create hidden container with the HTML
  const container = document.createElement("div");
  container.innerHTML = htmlContent;
  container.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: ${contentWidth}px;
    background: white;
    padding: 20px;
    box-sizing: border-box;
  `;
  document.body.appendChild(container);

  try {
    // Wait for images to load
    await waitForImages(container);

    // Render to canvas with high quality
    const canvas = await html2canvas(container, {
      scale: 2, // Higher resolution
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: contentWidth,
    });

    // Create PDF
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: pageSize,
    });

    const imgData = canvas.toDataURL("image/png", 1.0);
    const imgWidth = contentWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    // Handle multi-page content
    let heightLeft = imgHeight;
    let position = margin;
    const usableHeight = pageHeight - margin * 2;

    // First page
    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= usableHeight;

    // Additional pages if needed
    while (heightLeft > 0) {
      position -= usableHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= usableHeight;
    }

    return pdf.output("blob");
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Download a proposal as PDF
 */
export async function downloadProposalPdf(
  htmlContent: string,
  filename: string,
  options?: ProposalPdfOptions
): Promise<void> {
  const blob = await generateProposalPdf(htmlContent, options);
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Wait for all images in container to load
 */
function waitForImages(container: HTMLElement): Promise<void[]> {
  const images = container.querySelectorAll("img");
  const promises = Array.from(images).map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
  });
  return Promise.all(promises);
}
