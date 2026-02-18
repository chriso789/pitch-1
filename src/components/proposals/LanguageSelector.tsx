import { Globe } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'ht', label: 'Kreyòl Ayisyen' },
] as const;

interface LanguageSelectorProps {
  value: string;
  onChange: (lang: string) => void;
  className?: string;
}

export const LanguageSelector = ({ value, onChange, className }: LanguageSelectorProps) => {
  return (
    <div className={className}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[180px]">
          <Globe className="h-4 w-4 mr-2 text-muted-foreground" />
          <SelectValue placeholder="Language" />
        </SelectTrigger>
        <SelectContent>
          {LANGUAGES.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export { LANGUAGES };
