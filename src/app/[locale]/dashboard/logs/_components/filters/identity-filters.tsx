"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getKeys } from "@/actions/keys";
import { searchUsersForFilter } from "@/actions/users";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/lib/hooks/use-debounce";
import type { Key } from "@/types/key";
import type { UsageLogFilters } from "./types";

interface IdentityFiltersProps {
  isAdmin: boolean;
  filters: UsageLogFilters;
  onFiltersChange: (filters: UsageLogFilters) => void;
  initialKeys: Key[];
  isKeysLoading?: boolean;
  onKeysChange?: (keys: Key[]) => void;
  onUsersChange?: (users: Array<{ id: number; name: string }>) => void;
}

export function IdentityFilters({
  isAdmin,
  filters,
  onFiltersChange,
  initialKeys,
  isKeysLoading = false,
  onKeysChange,
  onUsersChange,
}: IdentityFiltersProps) {
  const t = useTranslations("dashboard");

  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const debouncedUserSearchTerm = useDebounce(userSearchTerm, 300);
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: number; name: string }>>([]);
  const userSearchRequestIdRef = useRef(0);
  const lastLoadedUserSearchTermRef = useRef<string | undefined>(undefined);
  const isMountedRef = useRef(true);

  const [keys, setKeys] = useState<Key[]>(initialKeys);
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);

  const userMap = useMemo(
    () => new Map(availableUsers.map((user) => [user.id, user.name])),
    [availableUsers]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadUsersForFilter = useCallback(
    async (term?: string) => {
      const requestId = ++userSearchRequestIdRef.current;
      setIsUsersLoading(true);
      lastLoadedUserSearchTermRef.current = term;

      try {
        const result = await searchUsersForFilter(term);
        if (!isMountedRef.current || requestId !== userSearchRequestIdRef.current) return;

        if (result.ok) {
          setAvailableUsers(result.data);
          onUsersChange?.(result.data);
        } else {
          console.error("Failed to load users for filter:", result.error);
          setAvailableUsers([]);
        }
      } catch (error) {
        if (!isMountedRef.current || requestId !== userSearchRequestIdRef.current) return;

        console.error("Failed to load users for filter:", error);
        setAvailableUsers([]);
      } finally {
        if (isMountedRef.current && requestId === userSearchRequestIdRef.current) {
          setIsUsersLoading(false);
        }
      }
    },
    [onUsersChange]
  );

  useEffect(() => {
    if (!isAdmin) return;
    void loadUsersForFilter(undefined);
  }, [isAdmin, loadUsersForFilter]);

  useEffect(() => {
    if (!isAdmin || !userPopoverOpen) return;

    const term = debouncedUserSearchTerm.trim() || undefined;
    if (term === lastLoadedUserSearchTermRef.current) return;

    void loadUsersForFilter(term);
  }, [isAdmin, userPopoverOpen, debouncedUserSearchTerm, loadUsersForFilter]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!userPopoverOpen) {
      setUserSearchTerm("");
    }
  }, [isAdmin, userPopoverOpen]);

  useEffect(() => {
    if (initialKeys.length > 0) {
      setKeys(initialKeys);
    }
  }, [initialKeys]);

  // Load initial keys if userId is set
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run only on mount
  useEffect(() => {
    const loadInitialKeys = async () => {
      if (isAdmin && filters.userId && initialKeys.length === 0) {
        try {
          const keysResult = await getKeys(filters.userId);
          if (keysResult.ok && keysResult.data) {
            setKeys(keysResult.data);
            onKeysChange?.(keysResult.data);
          }
        } catch (error) {
          console.error("Failed to load initial keys:", error);
        }
      }
    };
    loadInitialKeys();
  }, []);

  const handleUserChange = async (userId: string) => {
    const newUserId = userId ? parseInt(userId, 10) : undefined;
    const newFilters = { ...filters, userId: newUserId, keyId: undefined };
    onFiltersChange(newFilters);

    if (newUserId) {
      try {
        const keysResult = await getKeys(newUserId);
        if (keysResult.ok && keysResult.data) {
          setKeys(keysResult.data);
          onKeysChange?.(keysResult.data);
        }
      } catch (error) {
        console.error("Failed to load keys:", error);
        toast.error(t("logs.error.loadKeysFailed"));
      }
    } else {
      setKeys([]);
      onKeysChange?.([]);
    }
  };

  const handleKeyChange = (value: string) => {
    onFiltersChange({
      ...filters,
      keyId: value && value !== "__all__" ? parseInt(value, 10) : undefined,
    });
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* User selector (Admin only) */}
      {isAdmin && (
        <div className="space-y-2">
          <Label>{t("logs.filters.user")}</Label>
          <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={userPopoverOpen}
                type="button"
                className="w-full justify-between"
              >
                {filters.userId ? (
                  (userMap.get(filters.userId) ?? filters.userId.toString())
                ) : (
                  <span className="text-muted-foreground">
                    {isUsersLoading ? t("logs.stats.loading") : t("logs.filters.allUsers")}
                  </span>
                )}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[320px] p-0"
              align="start"
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder={t("logs.filters.searchUser")}
                  value={userSearchTerm}
                  onValueChange={(value) => setUserSearchTerm(value)}
                />
                <CommandList className="max-h-[250px] overflow-y-auto">
                  <CommandEmpty>
                    {isUsersLoading ? t("logs.stats.loading") : t("logs.filters.noUserFound")}
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value={t("logs.filters.allUsers")}
                      onSelect={() => {
                        void handleUserChange("");
                        setUserPopoverOpen(false);
                      }}
                      className="cursor-pointer"
                    >
                      <span className="flex-1">{t("logs.filters.allUsers")}</span>
                      {!filters.userId && <Check className="h-4 w-4 text-primary" />}
                    </CommandItem>
                    {availableUsers.map((user) => (
                      <CommandItem
                        key={user.id}
                        value={user.name}
                        onSelect={() => {
                          void handleUserChange(user.id.toString());
                          setUserPopoverOpen(false);
                        }}
                        className="cursor-pointer"
                      >
                        <span className="flex-1">{user.name}</span>
                        {filters.userId === user.id && <Check className="h-4 w-4 text-primary" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Key selector */}
      <div className="space-y-2">
        <Label>{t("logs.filters.apiKey")}</Label>
        <Select
          value={filters.keyId?.toString() || "__all__"}
          onValueChange={handleKeyChange}
          disabled={isKeysLoading || (isAdmin && !filters.userId && keys.length === 0)}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                isKeysLoading
                  ? t("logs.stats.loading")
                  : isAdmin && !filters.userId && keys.length === 0
                    ? t("logs.filters.selectUserFirst")
                    : t("logs.filters.allKeys")
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t("logs.filters.allKeys")}</SelectItem>
            {keys.map((key) => (
              <SelectItem key={key.id} value={key.id.toString()}>
                {key.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
