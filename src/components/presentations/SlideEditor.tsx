import { TitleSlideEditor } from "./slide-editors/TitleSlideEditor";
import { TextSlideEditor } from "./slide-editors/TextSlideEditor";
import { ImageSlideEditor } from "./slide-editors/ImageSlideEditor";
import { VideoSlideEditor } from "./slide-editors/VideoSlideEditor";
import { EstimateSummarySlideEditor } from "./slide-editors/EstimateSummarySlideEditor";
import { TestimonialSlideEditor } from "./slide-editors/TestimonialSlideEditor";
import { SignatureSlideEditor } from "./slide-editors/SignatureSlideEditor";

interface SlideEditorProps {
  slide: any;
  onSlideUpdate: () => void;
}

export const SlideEditor = ({ slide, onSlideUpdate }: SlideEditorProps) => {
  const renderEditor = () => {
    switch (slide.slide_type) {
      case "title":
        return <TitleSlideEditor slide={slide} onUpdate={onSlideUpdate} />;
      case "text":
        return <TextSlideEditor slide={slide} onUpdate={onSlideUpdate} />;
      case "image":
        return <ImageSlideEditor slide={slide} onUpdate={onSlideUpdate} />;
      case "video":
        return <VideoSlideEditor slide={slide} onUpdate={onSlideUpdate} />;
      case "estimate_summary":
        return <EstimateSummarySlideEditor slide={slide} onUpdate={onSlideUpdate} />;
      case "testimonial":
        return <TestimonialSlideEditor slide={slide} onUpdate={onSlideUpdate} />;
      case "signature":
        return <SignatureSlideEditor slide={slide} onUpdate={onSlideUpdate} />;
      default:
        return (
          <div className="text-center text-muted-foreground py-12">
            <p>Unknown slide type: {slide.slide_type}</p>
          </div>
        );
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <span className="text-sm text-muted-foreground">
          Slide {slide.slide_order + 1} • {slide.slide_type}
        </span>
      </div>
      {renderEditor()}
    </div>
  );
};
