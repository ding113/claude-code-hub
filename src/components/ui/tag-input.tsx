"use client";

import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";

export interface TagInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  value: string[];
  onChange: (tags: string[]) => void;
  maxTags?: number;
  maxTagLength?: number;
  allowDuplicates?: boolean;
  separator?: RegExp;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  validateTag?: (tag: string) => boolean;
  onInvalidTag?: (tag: string, reason: string) => void;
  /** 可选的建议列表，支持下拉搜索选择 */
  suggestions?: string[];
}

const DEFAULT_SEPARATOR = /[,，\n]/; // 逗号、中文逗号、换行符
const DEFAULT_TAG_PATTERN = /^[a-zA-Z0-9_-]+$/; // 字母、数字、下划线、连字符

export function TagInput({
  value = [],
  onChange,
  maxTags,
  maxTagLength = 50,
  allowDuplicates = false,
  separator = DEFAULT_SEPARATOR,
  placeholder,
  className,
  disabled,
  validateTag,
  onInvalidTag,
  suggestions = [],
  ...props
}: TagInputProps) {
  const [inputValue, setInputValue] = React.useState("");
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // 过滤建议列表：匹配输入值且未被选中
  const filteredSuggestions = React.useMemo(() => {
    if (!suggestions.length) return [];
    const search = inputValue.toLowerCase();
    return suggestions.filter(
      (s) => s.toLowerCase().includes(search) && (allowDuplicates || !value.includes(s))
    );
  }, [suggestions, inputValue, value, allowDuplicates]);

  // 默认验证函数
  const defaultValidateTag = React.useCallback(
    (tag: string): boolean => {
      if (!tag || tag.trim().length === 0) {
        onInvalidTag?.(tag, "empty");
        return false;
      }

      if (tag.length > maxTagLength) {
        onInvalidTag?.(tag, "too_long");
        return false;
      }

      if (!DEFAULT_TAG_PATTERN.test(tag)) {
        onInvalidTag?.(tag, "invalid_format");
        return false;
      }

      if (!allowDuplicates && value.includes(tag)) {
        onInvalidTag?.(tag, "duplicate");
        return false;
      }

      if (maxTags && value.length >= maxTags) {
        onInvalidTag?.(tag, "max_tags");
        return false;
      }

      return true;
    },
    [value, maxTags, maxTagLength, allowDuplicates, onInvalidTag]
  );

  const handleValidateTag = validateTag || defaultValidateTag;

  const addTag = React.useCallback(
    (tag: string) => {
      const trimmedTag = tag.trim();
      if (handleValidateTag(trimmedTag)) {
        onChange([...value, trimmedTag]);
        setInputValue("");
        setShowSuggestions(false);
        setHighlightedIndex(-1);
      }
    },
    [value, onChange, handleValidateTag]
  );

  const removeTag = React.useCallback(
    (indexToRemove: number) => {
      onChange(value.filter((_, index) => index !== indexToRemove));
    },
    [value, onChange]
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // 下拉列表导航
      if (showSuggestions && filteredSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev < filteredSuggestions.length - 1 ? prev + 1 : 0));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredSuggestions.length - 1));
          return;
        }
        if (e.key === "Enter" && highlightedIndex >= 0) {
          e.preventDefault();
          addTag(filteredSuggestions[highlightedIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowSuggestions(false);
          setHighlightedIndex(-1);
          return;
        }
      }

      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (inputValue.trim()) {
          addTag(inputValue);
        }
      } else if (e.key === "Backspace" && inputValue === "" && value.length > 0) {
        removeTag(value.length - 1);
      }
    },
    [inputValue, value, addTag, removeTag, showSuggestions, filteredSuggestions, highlightedIndex]
  );

  const handleInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;

      // 检测分隔符（逗号、换行符等）
      if (separator.test(newValue)) {
        const tags = newValue.split(separator).filter((t) => t.trim());
        tags.forEach((tag) => {
          if (tag.trim()) {
            addTag(tag);
          }
        });
      } else {
        setInputValue(newValue);
        // 有建议列表时，输入触发显示
        if (suggestions.length > 0) {
          setShowSuggestions(true);
          setHighlightedIndex(-1);
        }
      }
    },
    [separator, addTag, suggestions.length]
  );

  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pastedText = e.clipboardData.getData("text");
      const tags = pastedText.split(separator).filter((t) => t.trim());

      tags.forEach((tag) => {
        if (tag.trim()) {
          addTag(tag);
        }
      });
    },
    [separator, addTag]
  );

  // Commit pending input value on blur (e.g., when clicking save button)
  const handleBlur = React.useCallback(
    (_e: React.FocusEvent<HTMLInputElement>) => {
      // 延迟关闭，允许点击建议项
      setTimeout(() => {
        // 检查焦点是否还在容器内
        if (!containerRef.current?.contains(document.activeElement)) {
          if (inputValue.trim()) {
            addTag(inputValue);
          }
          setShowSuggestions(false);
          setHighlightedIndex(-1);
        }
      }, 150);
    },
    [inputValue, addTag]
  );

  const handleFocus = React.useCallback(() => {
    if (suggestions.length > 0) {
      setShowSuggestions(true);
    }
  }, [suggestions.length]);

  const handleSuggestionClick = React.useCallback(
    (suggestion: string) => {
      addTag(suggestion);
      inputRef.current?.focus();
    },
    [addTag]
  );

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none",
          "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          disabled && "pointer-events-none cursor-not-allowed opacity-50",
          className
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag, index) => (
          <Badge
            key={`${tag}-${index}`}
            variant="secondary"
            className="gap-1 pr-1.5 pl-2 py-1 h-auto"
          >
            <span className="text-xs">{tag}</span>
            {!disabled && (
              <button
                type="button"
                className="ml-1 rounded-full outline-none hover:bg-muted-foreground/20 focus:ring-2 focus:ring-ring/50"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(index);
                }}
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleBlur}
          onFocus={handleFocus}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder : undefined}
          className={cn(
            "flex-1 min-w-[120px] bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
          )}
          autoComplete="off"
          {...props}
        />
      </div>
      {/* 建议下拉列表 */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-auto">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              className={cn(
                "w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                index === highlightedIndex && "bg-accent text-accent-foreground"
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // 阻止 blur 事件
                handleSuggestionClick(suggestion);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
