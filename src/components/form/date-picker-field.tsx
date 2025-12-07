"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * DatePickerField component props
 */
export interface DatePickerFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  touched?: boolean;
  required?: boolean;
  description?: string;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * Format date to YYYY-MM-DD string
 */
function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Parse YYYY-MM-DD string to Date object
 * Uses local timezone to avoid off-by-one errors
 */
function parseDate(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  const [year, month, day] = dateStr.split("-").map(Number);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return undefined;
  return new Date(year, month - 1, day);
}

/**
 * DatePickerField - A form-integrated date picker using shadcn/ui Calendar
 * Replaces native HTML date input with a consistent, styled date picker
 */
export function DatePickerField({
  label,
  value,
  onChange,
  error,
  touched,
  required,
  description,
  placeholder,
  minDate,
  maxDate,
  disabled,
  className,
  id,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const hasError = Boolean(touched && error);
  const autoId = useId();
  const fieldId = id || `datepicker-${autoId}`;

  const selectedDate = useMemo(() => parseDate(value), [value]);

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange(formatDate(date));
      setOpen(false);
    } else {
      onChange("");
    }
  };

  const displayValue = useMemo(() => {
    if (!value) return placeholder || "";
    return value;
  }, [value, placeholder]);

  const disabledMatcher = useMemo(() => {
    const matchers: Array<{ before: Date } | { after: Date }> = [];
    if (minDate) matchers.push({ before: minDate });
    if (maxDate) matchers.push({ after: maxDate });
    return matchers.length > 0 ? matchers : undefined;
  }, [minDate, maxDate]);

  return (
    <div className={cn("grid gap-2", className)}>
      <Label
        htmlFor={fieldId}
        className={cn(required && "after:content-['*'] after:ml-0.5 after:text-destructive")}
      >
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={fieldId}
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal h-9",
              !value && "text-muted-foreground",
              hasError && "border-destructive focus-visible:ring-destructive"
            )}
            aria-invalid={hasError}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-describedby={
              hasError ? `${fieldId}-error` : description ? `${fieldId}-description` : undefined
            }
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {displayValue}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            defaultMonth={selectedDate || new Date()}
            disabled={disabledMatcher}
          />
        </PopoverContent>
      </Popover>
      {description && !hasError && (
        <div id={`${fieldId}-description`} className="text-xs text-muted-foreground">
          {description}
        </div>
      )}
      {hasError && (
        <div id={`${fieldId}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
