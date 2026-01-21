/**
 * @vitest-environment happy-dom
 *
 * 单元测试：用户管理 Dialog 组件
 *
 * 测试对象：
 * - EditUserDialog
 * - EditKeyDialog
 * - AddKeyDialog
 * - CreateUserDialog
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

// ==================== Mocks ====================

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock @/i18n/routing
vi.mock("@/i18n/routing", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Mock Server Actions
const mockEditUser = vi.fn().mockResolvedValue({ ok: true });
const mockRemoveUser = vi.fn().mockResolvedValue({ ok: true });
const mockToggleUserEnabled = vi.fn().mockResolvedValue({ ok: true });
const mockAddKey = vi.fn().mockResolvedValue({ ok: true, data: { key: "sk-test-key" } });
const mockEditKey = vi.fn().mockResolvedValue({ ok: true });
const mockCreateUserOnly = vi.fn().mockResolvedValue({ ok: true, data: { user: { id: 1 } } });

vi.mock("@/actions/users", () => ({
  editUser: (...args: unknown[]) => mockEditUser(...args),
  removeUser: (...args: unknown[]) => mockRemoveUser(...args),
  toggleUserEnabled: (...args: unknown[]) => mockToggleUserEnabled(...args),
  createUserOnly: (...args: unknown[]) => mockCreateUserOnly(...args),
}));

vi.mock("@/actions/keys", () => ({
  addKey: (...args: unknown[]) => mockAddKey(...args),
  editKey: (...args: unknown[]) => mockEditKey(...args),
  removeKey: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/actions/usage-logs", () => {
  return {
    getFilterOptions: () => Promise.resolve({ ok: true, data: { models: [] } }),
  };
});

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Dialog components to simplify rendering
vi.mock("@/components/ui/dialog", () => {
  type PropsWithChildren = { children?: ReactNode };
  type DialogContentProps = PropsWithChildren & { className?: string };

  function Dialog({ children }: PropsWithChildren) {
    return <div data-testid="dialog-root">{children}</div>;
  }

  function DialogContent({ children, className }: DialogContentProps) {
    return (
      <div data-testid="dialog-content" className={className}>
        {children}
      </div>
    );
  }

  function DialogHeader({ children }: PropsWithChildren) {
    return <div data-testid="dialog-header">{children}</div>;
  }

  function DialogTitle({ children }: PropsWithChildren) {
    return <h2 data-testid="dialog-title">{children}</h2>;
  }

  function DialogDescription({ children, className }: PropsWithChildren & { className?: string }) {
    return (
      <p data-testid="dialog-description" className={className}>
        {children}
      </p>
    );
  }

  function DialogFooter({ children, className }: PropsWithChildren & { className?: string }) {
    return (
      <div data-testid="dialog-footer" className={className}>
        {children}
      </div>
    );
  }

  return { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
});

// Mock form components
vi.mock("@/app/[locale]/dashboard/_components/user/forms/user-edit-section", () => ({
  UserEditSection: ({ user, onChange, translations: _translations }: any) => (
    <div data-testid="user-edit-section" data-user-id={user?.id}>
      <input
        data-testid="user-name-input"
        value={user?.name || ""}
        onChange={(e) => onChange("name", e.target.value)}
      />
    </div>
  ),
}));

vi.mock("@/app/[locale]/dashboard/_components/user/forms/key-edit-section", () => ({
  KeyEditSection: ({ keyData, onChange, translations: _translations }: any) => (
    <div data-testid="key-edit-section" data-key-id={keyData?.id}>
      <input
        data-testid="key-name-input"
        value={keyData?.name || ""}
        onChange={(e) => onChange("name", e.target.value)}
      />
    </div>
  ),
}));

vi.mock("@/app/[locale]/dashboard/_components/user/forms/danger-zone", () => ({
  DangerZone: ({ userId, userName, onDelete }: any) => (
    <div data-testid="danger-zone" data-user-id={userId}>
      <button data-testid="delete-button" onClick={onDelete}>
        Delete {userName}
      </button>
    </div>
  ),
}));

vi.mock("@/app/[locale]/dashboard/_components/user/forms/add-key-form", () => ({
  AddKeyForm: ({ userId, onSuccess }: any) => (
    <div data-testid="add-key-form" data-user-id={userId}>
      <button
        data-testid="add-key-submit"
        onClick={() => onSuccess({ generatedKey: "sk-test", name: "test" })}
      >
        Add Key
      </button>
    </div>
  ),
}));

vi.mock("@/app/[locale]/dashboard/_components/user/forms/edit-key-form", () => ({
  EditKeyForm: ({ keyData, onSuccess }: any) => (
    <div data-testid="edit-key-form" data-key-id={keyData?.id}>
      <button data-testid="edit-key-submit" onClick={() => onSuccess()}>
        Save Key
      </button>
    </div>
  ),
}));

// Import components after mocks
import { EditUserDialog } from "@/app/[locale]/dashboard/_components/user/edit-user-dialog";
import { EditKeyDialog } from "@/app/[locale]/dashboard/_components/user/edit-key-dialog";
import { AddKeyDialog } from "@/app/[locale]/dashboard/_components/user/add-key-dialog";
import { CreateUserDialog } from "@/app/[locale]/dashboard/_components/user/create-user-dialog";
import type { UserDisplay } from "@/types/user";

// ==================== Test Utilities ====================

const messages = {
  common: {
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    copySuccess: "Copied",
    copyFailed: "Copy failed",
  },
  ui: {
    tagInput: {
      emptyTag: "Empty tag",
      duplicateTag: "Duplicate tag",
      tooLong: "Too long",
      invalidFormat: "Invalid format",
      maxTags: "Too many tags",
    },
  },
  dashboard: {
    userManagement: {
      editDialog: {
        title: "Edit User",
        description: "Edit user information",
        saving: "Saving...",
        saveSuccess: "User saved",
        saveFailed: "Save failed",
        operationFailed: "Operation failed",
        userDisabled: "User disabled",
        userEnabled: "User enabled",
        deleteFailed: "Delete failed",
        userDeleted: "User deleted",
      },
      createDialog: {
        title: "Create User",
        description: "Create a new user with API key",
        creating: "Creating...",
        create: "Create",
        saveFailed: "Create failed",
        successTitle: "User Created",
        successDescription: "User created successfully",
        generatedKey: "Generated Key",
        keyHint: "Save this key, it cannot be recovered",
      },
      userEditSection: {
        sections: {
          basicInfo: "Basic Info",
          expireTime: "Expiration",
          limitRules: "Limits",
          accessRestrictions: "Access",
        },
        fields: {
          username: { label: "Username", placeholder: "Enter username" },
          description: { label: "Note", placeholder: "Enter note" },
          tags: { label: "Tags", placeholder: "Enter tags" },
          providerGroup: { label: "Provider Group", placeholder: "Select group" },
          enableStatus: {
            label: "Status",
            enabledDescription: "Enabled",
            disabledDescription: "Disabled",
            confirmEnable: "Enable",
            confirmDisable: "Disable",
            confirmEnableTitle: "Enable User",
            confirmDisableTitle: "Disable User",
            confirmEnableDescription: "Enable this user?",
            confirmDisableDescription: "Disable this user?",
            cancel: "Cancel",
            processing: "Processing...",
          },
          allowedClients: {
            label: "Allowed Clients",
            description: "Restrict clients",
            customLabel: "Custom",
            customPlaceholder: "Custom client",
          },
          allowedModels: {
            label: "Allowed Models",
            placeholder: "Select models",
            description: "Restrict models",
          },
        },
        presetClients: {
          "claude-cli": "Claude CLI",
          "gemini-cli": "Gemini CLI",
          "factory-cli": "Factory CLI",
          "codex-cli": "Codex CLI",
        },
      },
      keyEditSection: {
        sections: {
          basicInfo: "Basic Information",
          expireTime: "Expiration Time",
          limitRules: "Limit Rules",
          specialFeatures: "Special Features",
        },
        fields: {
          keyName: { label: "Key Name", placeholder: "Enter key name" },
          providerGroup: { label: "Provider Group", placeholder: "Default: default" },
          cacheTtl: {
            label: "Cache TTL Override",
            options: { inherit: "No override", "5m": "5m", "1h": "1h" },
          },
          balanceQueryPage: {
            label: "Independent Personal Usage Page",
            description: "When enabled, this key can access an independent personal usage page",
            descriptionEnabled: "Enabled description",
            descriptionDisabled: "Disabled description",
          },
          enableStatus: {
            label: "Enable Status",
            description: "Disabled keys cannot be used",
          },
        },
      },
      dangerZone: {
        title: "Danger Zone",
        deleteUser: "Delete User",
        deleteUserDescription: "This action cannot be undone",
        deleteConfirm: "Type username to confirm",
        deleteButton: "Delete",
      },
      limitRules: {
        addRule: "Add Rule",
        ruleTypes: {
          limitRpm: "RPM",
          limit5h: "5h Limit",
          limitDaily: "Daily",
          limitWeekly: "Weekly",
          limitMonthly: "Monthly",
          limitTotal: "Total",
          limitSessions: "Sessions",
        },
        quickValues: {
          unlimited: "Unlimited",
          "10": "$10",
          "50": "$50",
          "100": "$100",
          "500": "$500",
        },
      },
      quickExpire: {
        oneWeek: "1 Week",
        oneMonth: "1 Month",
        threeMonths: "3 Months",
        oneYear: "1 Year",
      },
      providerGroupSelect: {
        providersSuffix: "providers",
        loadFailed: "Failed to load provider groups",
      },
    },
    addKeyForm: {
      title: "Add Key",
      description: "Add a new API key",
      successTitle: "Key Created",
      successDescription: "Key created successfully",
      generatedKey: {
        label: "Generated Key",
        hint: "Save this key",
      },
      keyName: {
        label: "Key Name",
      },
    },
  },
  quota: {
    keys: {
      editKeyForm: {
        title: "Edit Key",
        description: "Edit key settings",
      },
    },
  },
};

let queryClient: QueryClient;

function renderWithProviders(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          {node}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// Mock user data
const mockUser: UserDisplay = {
  id: 1,
  name: "Test User",
  note: "Test note",
  role: "user",
  rpm: 10,
  dailyQuota: 100,
  providerGroup: "default",
  tags: ["test"],
  keys: [],
  isEnabled: true,
  expiresAt: null,
};

// ==================== Tests ====================

describe("EditUserDialog", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("renders dialog with user data when open", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <EditUserDialog open={true} onOpenChange={onOpenChange} user={mockUser} />
    );

    expect(container.querySelector('[data-testid="dialog-root"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dialog-title"]')?.textContent).toContain(
      "Edit User"
    );
    expect(container.querySelector('[data-testid="user-edit-section"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="danger-zone"]')).not.toBeNull();

    unmount();
  });

  test("does not render content when closed", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <EditUserDialog open={false} onOpenChange={onOpenChange} user={mockUser} />
    );

    // Dialog root exists but content should be minimal
    expect(container.querySelector('[data-testid="user-edit-section"]')).toBeNull();

    unmount();
  });

  test("passes correct user id to UserEditSection", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <EditUserDialog open={true} onOpenChange={onOpenChange} user={mockUser} />
    );

    const userEditSection = container.querySelector('[data-testid="user-edit-section"]');
    expect(userEditSection?.getAttribute("data-user-id")).toBe("1");

    unmount();
  });

  test("passes correct user id to DangerZone", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <EditUserDialog open={true} onOpenChange={onOpenChange} user={mockUser} />
    );

    const dangerZone = container.querySelector('[data-testid="danger-zone"]');
    expect(dangerZone?.getAttribute("data-user-id")).toBe("1");

    unmount();
  });

  test("has save and cancel buttons", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <EditUserDialog open={true} onOpenChange={onOpenChange} user={mockUser} />
    );

    const buttons = container.querySelectorAll("button");
    const buttonTexts = Array.from(buttons).map((b) => b.textContent);

    expect(buttonTexts).toContain("Save");
    expect(buttonTexts).toContain("Cancel");

    unmount();
  });
});

describe("EditKeyDialog", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  const mockKeyData = {
    id: 1,
    name: "Test Key",
    expiresAt: "2025-12-31",
    canLoginWebUi: false,
    providerGroup: null,
  };

  test("renders dialog with key data when open", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <EditKeyDialog open={true} onOpenChange={onOpenChange} keyData={mockKeyData} />
    );

    expect(container.querySelector('[data-testid="dialog-root"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dialog-title"]')?.textContent).toContain(
      "Edit Key"
    );
    expect(container.querySelector('[data-testid="edit-key-form"]')).not.toBeNull();

    unmount();
  });

  test("passes keyData to EditKeyForm", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <EditKeyDialog open={true} onOpenChange={onOpenChange} keyData={mockKeyData} />
    );

    const editKeyForm = container.querySelector('[data-testid="edit-key-form"]');
    expect(editKeyForm?.getAttribute("data-key-id")).toBe("1");

    unmount();
  });

  test("calls onOpenChange when dialog is closed", () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();

    const { container, unmount } = renderWithProviders(
      <EditKeyDialog
        open={true}
        onOpenChange={onOpenChange}
        keyData={mockKeyData}
        onSuccess={onSuccess}
      />
    );

    // Simulate clicking save in the mocked form
    const submitButton = container.querySelector('[data-testid="edit-key-submit"]') as HTMLElement;
    act(() => {
      submitButton?.click();
    });

    expect(onSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    unmount();
  });
});

describe("AddKeyDialog", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("renders dialog with add key form when open", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <AddKeyDialog open={true} onOpenChange={onOpenChange} userId={1} />
    );

    expect(container.querySelector('[data-testid="dialog-root"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dialog-title"]')?.textContent).toContain(
      "Add Key"
    );
    expect(container.querySelector('[data-testid="add-key-form"]')).not.toBeNull();

    unmount();
  });

  test("passes userId to AddKeyForm", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <AddKeyDialog open={true} onOpenChange={onOpenChange} userId={42} />
    );

    const addKeyForm = container.querySelector('[data-testid="add-key-form"]');
    expect(addKeyForm?.getAttribute("data-user-id")).toBe("42");

    unmount();
  });

  test("calls onSuccess after successful key creation", () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();

    const { container, unmount } = renderWithProviders(
      <AddKeyDialog open={true} onOpenChange={onOpenChange} userId={1} onSuccess={onSuccess} />
    );

    // Initially shows form
    expect(container.querySelector('[data-testid="add-key-form"]')).not.toBeNull();

    // Simulate successful key creation
    const submitButton = container.querySelector('[data-testid="add-key-submit"]') as HTMLElement;
    act(() => {
      submitButton?.click();
    });

    // onSuccess should be called
    expect(onSuccess).toHaveBeenCalled();

    // The component should now show the success view with generated key info
    // (key name "test" from mock result)
    expect(container.textContent).toContain("Key Created");

    unmount();
  });
});

describe("CreateUserDialog", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    mockCreateUserOnly.mockResolvedValue({ ok: true, data: { user: { id: 1 } } });
    mockAddKey.mockResolvedValue({ ok: true, data: { key: "sk-new-user-key" } });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("renders dialog with user and key sections when open", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <CreateUserDialog open={true} onOpenChange={onOpenChange} />
    );

    expect(container.querySelector('[data-testid="dialog-root"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dialog-title"]')?.textContent).toContain(
      "Create User"
    );
    expect(container.querySelector('[data-testid="user-edit-section"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="key-edit-section"]')).not.toBeNull();

    unmount();
  });

  test("does not render content when closed", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <CreateUserDialog open={false} onOpenChange={onOpenChange} />
    );

    expect(container.querySelector('[data-testid="user-edit-section"]')).toBeNull();
    expect(container.querySelector('[data-testid="key-edit-section"]')).toBeNull();

    unmount();
  });

  test("has create and cancel buttons", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <CreateUserDialog open={true} onOpenChange={onOpenChange} />
    );

    const buttons = container.querySelectorAll("button");
    const buttonTexts = Array.from(buttons).map((b) => b.textContent);

    expect(buttonTexts).toContain("Create");
    expect(buttonTexts).toContain("Cancel");

    unmount();
  });
});

describe("Dialog Component Integration", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("EditUserDialog re-renders with new user when user prop changes", () => {
    const onOpenChange = vi.fn();

    const { container, unmount } = renderWithProviders(
      <EditUserDialog open={true} onOpenChange={onOpenChange} user={mockUser} />
    );

    // Check initial user
    let userEditSection = container.querySelector('[data-testid="user-edit-section"]');
    expect(userEditSection?.getAttribute("data-user-id")).toBe("1");

    unmount();

    // Render with different user
    const newUser = { ...mockUser, id: 2, name: "New User" };
    const { container: container2, unmount: unmount2 } = renderWithProviders(
      <EditUserDialog open={true} onOpenChange={onOpenChange} user={newUser} />
    );

    userEditSection = container2.querySelector('[data-testid="user-edit-section"]');
    expect(userEditSection?.getAttribute("data-user-id")).toBe("2");

    unmount2();
  });

  test("all dialogs have accessible title", () => {
    const onOpenChange = vi.fn();

    // EditUserDialog
    const edit = renderWithProviders(
      <EditUserDialog open={true} onOpenChange={onOpenChange} user={mockUser} />
    );
    expect(edit.container.querySelector('[data-testid="dialog-title"]')).not.toBeNull();
    edit.unmount();

    // EditKeyDialog
    const editKey = renderWithProviders(
      <EditKeyDialog
        open={true}
        onOpenChange={onOpenChange}
        keyData={{ id: 1, name: "Key", expiresAt: "" }}
      />
    );
    expect(editKey.container.querySelector('[data-testid="dialog-title"]')).not.toBeNull();
    editKey.unmount();

    // AddKeyDialog
    const addKey = renderWithProviders(
      <AddKeyDialog open={true} onOpenChange={onOpenChange} userId={1} />
    );
    expect(addKey.container.querySelector('[data-testid="dialog-title"]')).not.toBeNull();
    addKey.unmount();

    // CreateUserDialog
    const create = renderWithProviders(
      <CreateUserDialog open={true} onOpenChange={onOpenChange} />
    );
    expect(create.container.querySelector('[data-testid="dialog-title"]')).not.toBeNull();
    create.unmount();
  });
});
