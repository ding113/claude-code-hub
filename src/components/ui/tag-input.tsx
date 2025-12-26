"use client";

import { X } from "lucide-react";
import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";

export type TagInputSuggestion =
  | string
  | {
      /** Tag value that will be added to `value[]` */
      value: string;
      /** Text shown in the suggestions dropdown */
      label: string;
      /** Optional extra keywords to improve search matching */
      keywords?: string[];
    };

export interface TagInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  value: string[];
  onChange: (tags: string[]) => void;
  onChangeCommit?: (tags: string[]) => void;
  maxTags?: number;
  maxTagLength?: number;
  maxVisibleTags?: number;
  onSuggestionsClose?: () => void;
  clearable?: boolean;
  clearLabel?: string;
  onClear?: () => void;
  allowDuplicates?: boolean;
  separator?: RegExp;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  validateTag?: (tag: string) => boolean;
  onInvalidTag?: (tag: string, reason: string) => void;
  /** 可选的建议列表，支持下拉搜索选择 */
  suggestions?: TagInputSuggestion[];
}

const DEFAULT_SEPARATOR = /[,，\n]/; // 逗号、中文逗号、换行符
const DEFAULT_TAG_PATTERN = /^[a-zA-Z0-9_-]+$/; // 字母、数字、下划线、连字符

export function TagInput({
  value = [],
  onChange,
  onChangeCommit,
  maxTags,
  maxTagLength = 50,
  maxVisibleTags,
  onSuggestionsClose,
  clearable = false,
  clearLabel,
  onClear,
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

  const normalizedMaxVisible = React.useMemo(() => {
    if (maxVisibleTags === undefined) return undefined;
    return Math.max(0, maxVisibleTags);
  }, [maxVisibleTags]);

  const { visibleTags, hiddenTags } = React.useMemo(() => {
    if (normalizedMaxVisible === undefined) {
      return { visibleTags: value, hiddenTags: [] as string[] };
    }
    return {
      visibleTags: value.slice(0, normalizedMaxVisible),
      hiddenTags: value.slice(normalizedMaxVisible),
    };
  }, [value, normalizedMaxVisible]);

  const previousShowSuggestions = React.useRef(showSuggestions);

  React.useEffect(() => {
    if (previousShowSuggestions.current && !showSuggestions) {
      onSuggestionsClose?.();
    }
    previousShowSuggestions.current = showSuggestions;
  }, [showSuggestions, onSuggestionsClose]);

  const inputMinWidthClass = normalizedMaxVisible === undefined ? "min-w-[120px]" : "min-w-[60px]";

  // Normalize suggestions so callers can provide either strings or { value, label } objects.
  const normalizedSuggestions = React.useMemo(() => {
    return suggestions.map((s) => (typeof s === "string" ? { value: s, label: s } : s));
  }, [suggestions]);

  // 过滤建议列表：匹配输入值且未被选中
  const filteredSuggestions = React.useMemo(() => {
    if (!normalizedSuggestions.length) return [];
    const search = inputValue.toLowerCase();
    return normalizedSuggestions.filter((s) => {
      const keywords = s.keywords?.join(" ") || "";
      const haystack = `${s.label} ${s.value} ${keywords}`.toLowerCase();
      return haystack.includes(search) && (allowDuplicates || !value.includes(s.value));
    });
  }, [normalizedSuggestions, inputValue, value, allowDuplicates]);

  // 基础验证函数（不包含默认格式校验）
  const validateBaseTag = React.useCallback(
    (tag: string, currentTags: string[]): boolean => {
      if (!tag || tag.trim().length === 0) {
        onInvalidTag?.(tag, "empty");
        return false;
      }

      if (tag.length > maxTagLength) {
        onInvalidTag?.(tag, "too_long");
        return false;
      }

      if (!allowDuplicates && currentTags.includes(tag)) {
        onInvalidTag?.(tag, "duplicate");
        return false;
      }

      if (maxTags && currentTags.length >= maxTags) {
        onInvalidTag?.(tag, "max_tags");
        return false;
      }

      return true;
    },
    [maxTags, maxTagLength, allowDuplicates, onInvalidTag]
  );

  const handleValidateTag = React.useCallback(
    (tag: string, currentTags: string[]): boolean => {
      if (!validateBaseTag(tag, currentTags)) return false;
      if (validateTag) return validateTag(tag);
      if (!DEFAULT_TAG_PATTERN.test(tag)) {
        onInvalidTag?.(tag, "invalid_format");
        return false;
      }
      return true;
    },
    [validateBaseTag, validateTag, onInvalidTag]
  );

  const commitIfClosed = React.useCallback(() => {
    if (!showSuggestions) {
      onSuggestionsClose?.();
    }
  }, [showSuggestions, onSuggestionsClose]);

  const addTag = React.useCallback(
    (tag: string, keepOpen = false) => {
      const trimmedTag = tag.trim();
      if (handleValidateTag(trimmedTag, value)) {
        onChange([...value, trimmedTag]);
        setInputValue("");
        if (!keepOpen) {
          setShowSuggestions(false);
        }
        setHighlightedIndex(-1);
        commitIfClosed();
      }
    },
    [value, onChange, handleValidateTag, commitIfClosed]
  );

  const addTagsBatch = React.useCallback(
    (tags: string[]) => {
      const nextTags = [...value];
      let didChange = false;

      for (const rawTag of tags) {
        const trimmedTag = rawTag.trim();
        if (!trimmedTag) continue;

        if (handleValidateTag(trimmedTag, nextTags)) {
          nextTags.push(trimmedTag);
          didChange = true;
        }
      }

      if (!didChange) return;

      onChange(nextTags);
      setInputValue("");
      setShowSuggestions(false);
      setHighlightedIndex(-1);
      commitIfClosed();
    },
    [value, onChange, handleValidateTag, commitIfClosed]
  );

  const removeTag = React.useCallback(
    (indexToRemove: number) => {
      const nextTags = value.filter((_, index) => index !== indexToRemove);
      onChange(nextTags);
      onChangeCommit?.(nextTags);
      setShowSuggestions(false);
      setHighlightedIndex(-1);
    },
    [value, onChange, onChangeCommit]
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
          addTag(filteredSuggestions[highlightedIndex].value, true); // keepOpen=true 保持下拉展开
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
        addTagsBatch(tags);
      } else {
        setInputValue(newValue);
        // 有建议列表时，输入触发显示
        if (suggestions.length > 0) {
          setShowSuggestions(true);
          setHighlightedIndex(-1);
        }
      }
    },
    [separator, addTagsBatch, suggestions.length]
  );

  const handlePaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pastedText = e.clipboardData.getData("text");
      const tags = pastedText.split(separator).filter((t) => t.trim());

      addTagsBatch(tags);
    },
    [separator, addTagsBatch]
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
    (suggestionValue: string) => {
      addTag(suggestionValue, true); // keepOpen=true 保持下拉展开
      inputRef.current?.focus();
    },
    [addTag]
  );

  const handleClear = React.useCallback(() => {
    if (disabled) return;
    const nextTags: string[] = [];
    if (onClear) {
      onClear();
    } else {
      onChange(nextTags);
    }
    onChangeCommit?.(nextTags);
    setInputValue("");
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  }, [disabled, onClear, onChange, onChangeCommit]);

  return (
    <div ref={containerRef} className="relative group">
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none",
          "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          disabled && "pointer-events-none cursor-not-allowed opacity-50",
          clearable && value.length > 0 && "pr-8",
          className
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {visibleTags.map((tag, index) => (
          <Badge
            key={`${tag}-${index}`}
            variant="secondary"
            className="gap-1 pr-1.5 pl-2 py-1 h-auto"
          >
            <span className="text-xs">{tag}</span>
            {!disabled && (
              <button
                type="button"
                className="ml-1 rounded-full outline-none hover:bg-muted-foreground/20 focus:ring-2 focus:ring-ring/50 cursor-pointer"
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
        {hiddenTags.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="pr-2 pl-2 py-1 h-auto">
                <span className="text-xs">+{hiddenTags.length}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {hiddenTags.join(", ")}
            </TooltipContent>
          </Tooltip>
        )}
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
            "flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm",
            inputMinWidthClass
          )}
          autoComplete="off"
          {...props}
        />
      </div>
      {clearable && value.length > 0 && !disabled && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
          aria-label={clearLabel || "Clear"}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {/* 建议下拉列表 */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-auto">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.value}
              type="button"
              className={cn(
                "w-full px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer",
                index === highlightedIndex && "bg-accent text-accent-foreground"
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // 阻止 blur 事件
                handleSuggestionClick(suggestion.value);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
