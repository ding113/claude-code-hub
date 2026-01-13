"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteProviderEndpointAction } from "@/actions/provider-endpoints";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProviderEndpoint } from "@/types/provider";

export function EndpointListItem({ endpoint }: { endpoint: ProviderEndpoint }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this endpoint?")) return;

    setIsDeleting(true);
    try {
      const result = await deleteProviderEndpointAction(endpoint.id);
      if (result.ok) {
        queryClient.invalidateQueries({ queryKey: ["provider-endpoints"] });
        toast.success("Endpoint deleted");
      } else {
        toast.error("Failed to delete endpoint");
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex items-center justify-between rounded-md border p-3 text-sm">
      <div className="flex flex-col gap-1 overflow-hidden">
        <div className="font-mono truncate" title={endpoint.baseUrl}>
          {endpoint.baseUrl}
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-[10px] h-5">
            P{endpoint.priority}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-5">
            W{endpoint.weight}
          </Badge>
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={handleDelete} disabled={isDeleting}>
        {isDeleting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4 text-destructive" />
        )}
      </Button>
    </div>
  );
}
