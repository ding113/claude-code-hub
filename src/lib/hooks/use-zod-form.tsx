import { useCallback, useState } from "react";
import { z } from "zod";

interface UseZodFormOptions<T extends z.ZodSchema> {
  schema: T;
  defaultValues: Partial<z.infer<T>>;
  onSubmit: (data: z.infer<T>) => Promise<void> | void;
}

interface FormErrors {
  [key: string]: string;
}

/**
 * 简化的 Zod 表单 hook
 */
export function useZodForm<T extends z.ZodSchema>({
  schema,
  defaultValues,
  onSubmit,
}: UseZodFormOptions<T>) {
  type Values = z.infer<T>;
  const [values, setValues] = useState<Partial<Values>>(defaultValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setValue = useCallback(
    (field: keyof Values, value: unknown) => {
      setValues((prev) => ({ ...prev, [field]: value as Values[keyof Values] }));
      if (errors[field as string]) {
        setErrors((prev) => ({ ...prev, [field as string]: "" }));
      }
    },
    [errors]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);
      setErrors({});

      try {
        const validatedData = schema.parse(values);
        await onSubmit(validatedData);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const formErrors: FormErrors = {};
          error.issues.forEach((issue: z.ZodIssue) => {
            const path = issue.path.join(".");
            formErrors[path] = issue.message;
          });
          setErrors(formErrors);
        } else {
          setErrors({ _form: error instanceof Error ? error.message : "提交失败" });
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [values, schema, onSubmit]
  );

  const getFieldProps = useCallback(
    (field: keyof Values) => {
      const raw = (values as Record<string, unknown>)[field as string];
      const value = (raw as string | number) ?? "";
      return {
        value,
        onChange: (val: string) => setValue(field, val),
        error: errors[field as string],
        touched: true,
      };
    },
    [values, errors, setValue]
  );

  const getArrayFieldProps = useCallback(
    (field: keyof Values) => {
      const raw = (values as Record<string, unknown>)[field as string];
      const value = (Array.isArray(raw) ? raw : []) as string[];
      return {
        value,
        onChange: (val: string[]) => setValue(field, val),
        error: errors[field as string],
        touched: true,
      };
    },
    [values, errors, setValue]
  );

  const canSubmit = Object.keys(values).length > 0 && !isSubmitting;

  return {
    values,
    errors,
    isSubmitting,
    canSubmit,
    setValue,
    handleSubmit,
    getFieldProps,
    getArrayFieldProps,
  };
}
