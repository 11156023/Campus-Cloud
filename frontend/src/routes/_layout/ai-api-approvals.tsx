import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Check, ClipboardCheck, X } from "lucide-react"
import { useState } from "react"

import { UsersService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import {
  type AiApiRequestPublic,
  type AiApiRequestStatus,
  AiApiService,
} from "@/services/aiApi"
import { handleError } from "@/utils"

export const Route = createFileRoute("/_layout/ai-api-approvals")({
  component: AiApiApprovalsPage,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!(user.role === "admin" || user.is_superuser)) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: "AI API Approvals - Campus Cloud",
      },
    ],
  }),
})

function formatTime(value?: string | null) {
  if (!value) return "尚未審核"
  return new Date(value).toLocaleString()
}

function ReviewDialog({
  open,
  onOpenChange,
  request,
  action,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: AiApiRequestPublic
  action: "approved" | "rejected"
}) {
  const [comment, setComment] = useState("")
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () =>
      AiApiService.reviewRequest({
        requestId: request.id,
        requestBody: {
          status: action,
          review_comment: comment || null,
        },
      }),
    onSuccess: () => {
      showSuccessToast(
        action === "approved" ? "AI API 申請已通過" : "AI API 申請已拒絕",
      )
      setComment("")
      onOpenChange(false)
      queryClient.invalidateQueries({ queryKey: ["ai-api", "admin-requests"] })
      queryClient.invalidateQueries({ queryKey: ["ai-api"] })
    },
    onError: handleError.bind(showErrorToast),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {action === "approved" ? "通過 AI API 申請" : "拒絕 AI API 申請"}
          </DialogTitle>
          <DialogDescription>
            {action === "approved"
              ? "通過後，系統會直接核發可用的 base_url 與 api_key。"
              : "你可以留下拒絕原因，讓申請者知道下一步。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2 rounded-lg border p-3 text-sm">
            <div>申請者：{request.user_full_name || request.user_email}</div>
            <div>申請時間：{formatTime(request.created_at)}</div>
            <div className="whitespace-pre-wrap text-muted-foreground">
              用途：{request.purpose}
            </div>
          </div>

          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="審核備註（可留空）"
            rows={4}
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={mutation.isPending}>
              取消
            </Button>
          </DialogClose>
          <LoadingButton
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
            variant={action === "approved" ? "default" : "destructive"}
          >
            {action === "approved" ? "確認通過" : "確認拒絕"}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RequestCard({ item }: { item: AiApiRequestPublic }) {
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">
            {item.user_full_name || item.user_email}
          </div>
          <div className="text-sm text-muted-foreground">
            申請時間：{formatTime(item.created_at)}
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          狀態：
          {item.status === "pending"
            ? "審核中"
            : item.status === "approved"
              ? "已通過"
              : "已拒絕"}
        </div>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium">用途</div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {item.purpose}
        </p>
      </div>

      {item.review_comment ? (
        <div className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
          審核意見：{item.review_comment}
        </div>
      ) : null}

      {item.status === "pending" ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setApproveOpen(true)}>
            <Check className="mr-1 h-4 w-4" />
            通過
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setRejectOpen(true)}
          >
            <X className="mr-1 h-4 w-4" />
            拒絕
          </Button>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          審核時間：{formatTime(item.reviewed_at)}
        </div>
      )}

      <ReviewDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        request={item}
        action="approved"
      />
      <ReviewDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        request={item}
        action="rejected"
      />
    </div>
  )
}

function AiApiApprovalsPage() {
  const [statusFilter, setStatusFilter] = useState<AiApiRequestStatus | "all">(
    "pending",
  )

  const requestsQuery = useQuery({
    queryKey: ["ai-api", "admin-requests", statusFilter],
    queryFn: () =>
      AiApiService.listAllRequests({
        status: statusFilter === "all" ? null : statusFilter,
      }),
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI API 審核</h1>
        <p className="text-muted-foreground">
          獨立審核 AI API 申請，通過後系統會直接核發連線參數。
        </p>
      </div>

      <Tabs
        value={statusFilter}
        onValueChange={(value) =>
          setStatusFilter(value as AiApiRequestStatus | "all")
        }
      >
        <TabsList>
          <TabsTrigger value="pending">待審核</TabsTrigger>
          <TabsTrigger value="approved">已通過</TabsTrigger>
          <TabsTrigger value="rejected">已拒絕</TabsTrigger>
          <TabsTrigger value="all">全部</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>申請清單</CardTitle>
          <CardDescription>
            切換篩選查看不同狀態的 AI API 申請。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {requestsQuery.data?.data.length ? (
            requestsQuery.data.data.map((item) => (
              <RequestCard key={item.id} item={item} />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
              <div className="mb-4 rounded-full bg-muted p-4">
                <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="font-medium">目前沒有符合條件的 AI API 申請</div>
              <div className="text-sm text-muted-foreground">
                切換上方篩選，或稍後再查看。
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
