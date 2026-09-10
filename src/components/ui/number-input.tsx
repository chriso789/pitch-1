import React, { useState, useEffect } from 'react';
import { Input } from './input';

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: number;
  onChange: (value: number) => void;
  allowNegative?: boolean;
}

/**
 * Number input that keeps a local string state so the user can type
 * intermediate characters like "-" without the value snapping to 0.
 *
 * `allowNegative` controls whether negative values are accepted.
 * When false, the underlying number is clamped to >= 0 but the user
 * can still see what they're typing (the sign is stripped on blur/parse).
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onChange, allowNegative = false, step, ...rest }, ref) => {
    const [str, setStr] = useState(String(value ?? 0));

    // Sync from external value changes (e.g. material autocomplete, reset)
    useEffect(() => {
      const currentNum = parseFloat(str);
      // Don't clobber an active intermediate state like "-" or ""
      if (isNaN(currentNum)) return;
      if (currentNum === value) return;
      setStr(String(value));
    }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setStr(raw);
      let num = parseFloat(raw);
      if (isNaN(num)) num = 0;
      if (!allowNegative && num < 0) num = 0;
      onChange(num);
    };

    return (
      <Input
        ref={ref}
        type="number"
        step={step}
        value={str}
        onChange={handleChange}
        {...rest}
      />
    );
  }
);

NumberInput.displayName = 'NumberInput';
