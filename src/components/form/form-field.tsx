"use client";

import { type ComponentProps, useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagInput } from "@/components/ui/tag-input";
import { cn } from "@/lib/utils";

/**
 * 表单字段配置
 */
export interface FormFieldConfig {
  label: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  type?: "text" | "email" | "password" | "number" | "date";
  description?: string;
}

/**
 * 表单字段状态
 */
export interface FormFieldState {
  value: string | number;
  error?: string;
  touched?: boolean;
}

/**
 * 通用表单字段组件
 */
export interface FormFieldProps extends Omit<ComponentProps<typeof Input>, "value" | "onChange"> {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  error?: string;
  touched?: boolean;
  required?: boolean;
  description?: string;
}

export function FormField({
  label,
  value,
  onChange,
  error,
  touched,
  required,
  description,
  className,
  ...inputProps
}: FormFieldProps) {
  const hasError = Boolean(touched && error);
  const autoId = useId();
  const fieldId = inputProps.id || `field-${autoId}`;

  return (
    <div className="grid gap-2">
      <Label
        htmlFor={fieldId}
        className={cn(required && "after:content-['*'] after:ml-0.5 after:text-destructive")}
      >
        {label}
      </Label>
      <Input
        {...inputProps}
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          hasError ? "border-destructive focus-visible:ring-destructive" : undefined,
          className
        )}
        aria-invalid={hasError}
        aria-describedby={
          hasError ? `${fieldId}-error` : description ? `${fieldId}-description` : undefined
        }
      />
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

/**
 * 文本字段组件
 */
export function TextField(props: FormFieldProps) {
  return <FormField type="text" {...props} />;
}

/**
 * 邮箱字段组件
 */
export function EmailField(props: FormFieldProps) {
  return <FormField type="email" {...props} />;
}

/**
 * 数字字段组件
 */
export function NumberField(
  props: Omit<FormFieldProps, "type"> & {
    min?: number;
    max?: number;
  }
) {
  return <FormField {...props} type="number" min={props.min} max={props.max} />;
}

/**
 * 日期字段组件
 */
export function DateField(props: FormFieldProps) {
  return <FormField type="date" {...props} />;
}

/**
 * 标签输入字段组件 Props (字符串值，逗号分隔)
 */
export interface TagInputFieldProps
  extends Omit<ComponentProps<typeof TagInput>, "value" | "onChange"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  touched?: boolean;
  required?: boolean;
  description?: string;
}

/**
 * 数组标签输入字段组件 Props (数组值)
 */
export interface ArrayTagInputFieldProps
  extends Omit<ComponentProps<typeof TagInput>, "value" | "onChange"> {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
  touched?: boolean;
  required?: boolean;
  description?: string;
}

/**
 * 标签输入字段组件
 * 用于与 react-hook-form 集成，接受 string 值（逗号分隔），内部转换为数组
 */
export function TagInputField({
  label,
  value,
  onChange,
  error,
  touched,
  required,
  description,
  className,
  ...tagInputProps
}: TagInputFieldProps) {
  const hasError = Boolean(touched && error);
  const autoId = useId();
  const fieldId = tagInputProps.id || `field-${autoId}`;

  // 将字符串转换为数组
  const tagsArray = value
    ? value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  // 将数组转换回字符串
  const handleChange = (tags: string[]) => {
    onChange(tags.join(","));
  };

  return (
    <div className="grid gap-2">
      <Label
        htmlFor={fieldId}
        className={cn(required && "after:content-['*'] after:ml-0.5 after:text-destructive")}
      >
        {label}
      </Label>
      <TagInput
        {...tagInputProps}
        id={fieldId}
        value={tagsArray}
        onChange={handleChange}
        className={cn(
          hasError ? "border-destructive focus-visible:ring-destructive" : undefined,
          className
        )}
        aria-invalid={hasError}
        aria-describedby={
          hasError ? `${fieldId}-error` : description ? `${fieldId}-description` : undefined
        }
      />
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

/**
 * 数组标签输入字段组件
 * 直接接受 string[] 值，适用于存储为数组的标签字段
 */
export function ArrayTagInputField({
  label,
  value,
  onChange,
  error,
  touched,
  required,
  description,
  className,
  ...tagInputProps
}: ArrayTagInputFieldProps) {
  const hasError = Boolean(touched && error);
  const autoId = useId();
  const fieldId = tagInputProps.id || `field-${autoId}`;

  return (
    <div className="grid gap-2">
      <Label
        htmlFor={fieldId}
        className={cn(required && "after:content-['*'] after:ml-0.5 after:text-destructive")}
      >
        {label}
      </Label>
      <TagInput
        {...tagInputProps}
        id={fieldId}
        value={value || []}
        onChange={onChange}
        className={cn(
          hasError ? "border-destructive focus-visible:ring-destructive" : undefined,
          className
        )}
        aria-invalid={hasError}
        aria-describedby={
          hasError ? `${fieldId}-error` : description ? `${fieldId}-description` : undefined
        }
      />
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
