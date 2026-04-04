import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import {
  AlertTriangle,
  CheckCircle,
  Database,
  Edit2,
  HardDrive,
  Layers,
  Lock,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  ShieldOff,
  Trash2,
  User,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { UsersService } from "@/client"
import { OpenAPI } from "@/client/core/OpenAPI"
import { request as __request } from "@/client/core/request"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProxmoxConfigPublic {
  host: string
  user: string
  verify_ssl: boolean
  iso_storage: string
  data_storage: string
  api_timeout: number
  task_check_interval: number
  pool_name: string
  gateway_ip: string | null
  local_subnet: string | null
  default_node: string | null
  updated_at: string | null
  is_configured: boolean
  has_ca_cert: boolean
  ca_fingerprint: string | null
}

interface ProxmoxConfigUpdate {
  host: string
  user: string
  password?: string | null
  verify_ssl: boolean
  iso_storage: string
  data_storage: string
  api_timeout: number
  task_check_interval: number
  pool_name: string
  ca_cert?: string | null
  gateway_ip?: string | null
  local_subnet?: string | null
  default_node?: string | null
}

interface ProxmoxNodePublic {
  id?: number | null
  name: string
  host: string
  port: number
  is_primary: boolean
  is_online: boolean
  last_checked?: string | null
  priority: number
}

interface ProxmoxNodeUpdate {
  host: string
  port: number
  priority: number
}

interface ClusterPreviewResult {
  success: boolean
  is_cluster: boolean
  nodes: ProxmoxNodePublic[]
  error?: string | null
}

interface ProxmoxConnectionTestResult {
  success: boolean
  message: string
}

interface CertParseResult {
  valid: boolean
  fingerprint: string | null
  subject: string | null
  issuer: string | null
  not_before: string | null
  not_after: string | null
  error: string | null
}

interface ProxmoxStoragePublic {
  id: number
  node_name: string
  storage: string
  storage_type: string | null
  total_gb: number
  used_gb: number
  avail_gb: number
  can_vm: boolean
  can_lxc: boolean
  can_iso: boolean
  can_backup: boolean
  is_shared: boolean
  active: boolean
  enabled: boolean
  speed_tier: string
  user_priority: number
}

interface SyncNowResult {
  success: boolean
  nodes: ProxmoxNodePublic[]
  storage_count: number
  error?: string | null
}

// ── API Service ────────────────────────────────────────────────────────────────

const ProxmoxConfigService = {
  getConfig: (): Promise<ProxmoxConfigPublic> =>
    __request(OpenAPI, { method: "GET", url: "/api/v1/proxmox-config/" }),

  updateConfig: (body: ProxmoxConfigUpdate): Promise<ProxmoxConfigPublic> =>
    __request(OpenAPI, {
      method: "PUT",
      url: "/api/v1/proxmox-config/",
      body,
      mediaType: "application/json",
    }),

  previewCluster: (body: ProxmoxConfigUpdate): Promise<ClusterPreviewResult> =>
    __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/proxmox-config/preview",
      body,
      mediaType: "application/json",
    }),

  getNodes: (): Promise<ProxmoxNodePublic[]> =>
    __request(OpenAPI, { method: "GET", url: "/api/v1/proxmox-config/nodes" }),

  checkNodes: (): Promise<ProxmoxNodePublic[]> =>
    __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/proxmox-config/check-nodes",
    }),

  updateNode: (
    nodeId: number,
    body: ProxmoxNodeUpdate,
  ): Promise<ProxmoxNodePublic> =>
    __request(OpenAPI, {
      method: "PUT",
      url: `/api/v1/proxmox-config/nodes/${nodeId}`,
      body,
      mediaType: "application/json",
    }),

  syncNow: (): Promise<SyncNowResult> =>
    __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/proxmox-config/sync-now",
    }),

  testConnection: (): Promise<ProxmoxConnectionTestResult> =>
    __request(OpenAPI, { method: "POST", url: "/api/v1/proxmox-config/test" }),

  parseCert: (pem: string): Promise<CertParseResult> =>
    __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/proxmox-config/parse-cert",
      body: { pem },
      mediaType: "application/json",
    }),

  getStorages: (): Promise<ProxmoxStoragePublic[]> =>
    __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/proxmox-config/storages",
    }),

  updateStorage: (
    storageId: number,
    body: { enabled: boolean; speed_tier: string; user_priority: number },
  ): Promise<ProxmoxStoragePublic> =>
    __request(OpenAPI, {
      method: "PUT",
      url: `/api/v1/proxmox-config/storages/${storageId}`,
      body,
      mediaType: "application/json",
    }),
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_layout/admin/proxmox")({
  component: AdminProxmoxPage,
  beforeLoad: async () => {
    const user = await UsersService.readUserMe()
    if (!(user.role === "admin" || user.is_superuser)) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "PVE 設定 - Campus Cloud" }],
  }),
})

// ── Form types ────────────────────────────────────────────────────────────────

interface ConfigFormData {
  host: string
  user: string
  password: string
  verify_ssl: boolean
  iso_storage: string
  data_storage: string
  api_timeout: number
  task_check_interval: number
  pool_name: string
  gateway_ip: string
  local_subnet: string
  default_node: string
}

interface NodeFormData {
  host: string
  port: number
  priority: number
}

// ── StorageTab sub-component ──────────────────────────────────────────────────

function StorageTab() {
  const queryClient = useQueryClient()
  const [nodeFilter, setNodeFilter] = useState<string>("all")

  const { data: storages, isLoading } = useQuery({
    queryKey: ["proxmoxStorages"],
    queryFn: ProxmoxConfigService.getStorages,
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number
      body: { enabled: boolean; speed_tier: string; user_priority: number }
    }) => ProxmoxConfigService.updateStorage(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxmoxStorages"] })
    },
    onError: () => toast.error("Storage 更新失敗"),
  })

  const nodeNames = storages
    ? Array.from(new Set(storages.map((s) => s.node_name))).sort()
    : []

  const filtered =
    storages?.filter(
      (s) => nodeFilter === "all" || s.node_name === nodeFilter,
    ) ?? []

  const speedTierLabel: Record<string, string> = {
    nvme: "NVMe",
    ssd: "SSD",
    hdd: "HDD",
    unknown: "未知",
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        載入中...
      </div>
    )
  }

  if (!storages || storages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
        <Database className="h-8 w-8" />
        <p>尚無 Storage 資料，請先在「節點管理」點擊「同步節點」。</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">篩選節點：</span>
        <Select value={nodeFilter} onValueChange={setNodeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部節點</SelectItem>
            {nodeNames.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="ml-auto">
          {filtered.length} 個 Storage
        </Badge>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Storage 名稱</TableHead>
              <TableHead>節點</TableHead>
              <TableHead>類型</TableHead>
              <TableHead>容量</TableHead>
              <TableHead>用途</TableHead>
              <TableHead>速度分級</TableHead>
              <TableHead className="w-24">優先級</TableHead>
              <TableHead className="w-16">啟用</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => (
              <TableRow key={s.id} className={!s.enabled ? "opacity-50" : ""}>
                <TableCell className="font-medium">
                  {s.storage}
                  {s.is_shared && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      共享
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {s.node_name}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {s.storage_type ?? "-"}
                </TableCell>
                <TableCell className="text-sm">
                  <span className="text-foreground">
                    {s.avail_gb.toFixed(1)} GB
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    / {s.total_gb.toFixed(1)} GB
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {s.can_vm && (
                      <Badge variant="secondary" className="text-xs">
                        VM
                      </Badge>
                    )}
                    {s.can_lxc && (
                      <Badge variant="secondary" className="text-xs">
                        LXC
                      </Badge>
                    )}
                    {s.can_iso && (
                      <Badge variant="secondary" className="text-xs">
                        ISO
                      </Badge>
                    )}
                    {s.can_backup && (
                      <Badge variant="secondary" className="text-xs">
                        備份
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={s.speed_tier}
                    onValueChange={(val) =>
                      updateMutation.mutate({
                        id: s.id,
                        body: {
                          enabled: s.enabled,
                          speed_tier: val,
                          user_priority: s.user_priority,
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-7 w-24 text-xs">
                      <SelectValue>
                        {speedTierLabel[s.speed_tier] ?? s.speed_tier}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nvme">NVMe</SelectItem>
                      <SelectItem value="ssd">SSD</SelectItem>
                      <SelectItem value="hdd">HDD</SelectItem>
                      <SelectItem value="unknown">未知</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    className="h-7 w-16 text-xs"
                    defaultValue={s.user_priority}
                    onBlur={(e) => {
                      const val = Math.min(
                        10,
                        Math.max(1, Number(e.target.value)),
                      )
                      if (val !== s.user_priority) {
                        updateMutation.mutate({
                          id: s.id,
                          body: {
                            enabled: s.enabled,
                            speed_tier: s.speed_tier,
                            user_priority: val,
                          },
                        })
                      }
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={(checked) =>
                      updateMutation.mutate({
                        id: s.id,
                        body: {
                          enabled: checked,
                          speed_tier: s.speed_tier,
                          user_priority: s.user_priority,
                        },
                      })
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ── Main Page Component ───────────────────────────────────────────────────────

function AdminProxmoxPage() {
  const queryClient = useQueryClient()
  const [testResult, setTestResult] =
    useState<ProxmoxConnectionTestResult | null>(null)

  // CA cert state
  const [caCertInput, setCaCertInput] = useState("")
  const [certInfo, setCertInfo] = useState<CertParseResult | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [caCertAction, setCaCertAction] = useState<
    "keep" | "clear" | "replace"
  >("keep")

  // Cluster confirm dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingFormData, setPendingFormData] = useState<ConfigFormData | null>(
    null,
  )
  const [previewResult, setPreviewResult] =
    useState<ClusterPreviewResult | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)

  // Node edit sheet
  const [editingNode, setEditingNode] = useState<ProxmoxNodePublic | null>(null)
  const nodeForm = useForm<NodeFormData>({
    defaultValues: { host: "", port: 8006, priority: 5 },
  })

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["proxmoxConfig"],
    queryFn: ProxmoxConfigService.getConfig,
  })

  const { data: nodes, isLoading: nodesLoading } = useQuery({
    queryKey: ["proxmoxNodes"],
    queryFn: ProxmoxConfigService.getNodes,
  })

  const form = useForm<ConfigFormData>({
    defaultValues: {
      host: "",
      user: "",
      password: "",
      verify_ssl: false,
      iso_storage: "local",
      data_storage: "local-lvm",
      api_timeout: 30,
      task_check_interval: 2,
      pool_name: "CampusCloud",
      gateway_ip: "",
      local_subnet: "",
      default_node: "",
    },
  })

  useEffect(() => {
    if (config) {
      form.reset({
        host: config.host,
        user: config.user,
        password: "",
        verify_ssl: config.verify_ssl,
        iso_storage: config.iso_storage,
        data_storage: config.data_storage,
        api_timeout: config.api_timeout,
        task_check_interval: config.task_check_interval,
        pool_name: config.pool_name,
        gateway_ip: config.gateway_ip ?? "",
        local_subnet: config.local_subnet ?? "",
        default_node: config.default_node ?? "",
      })
    }
  }, [config, form])

  const handleCertInput = async (value: string) => {
    setCaCertInput(value)
    setCertInfo(null)
    setCaCertAction("replace")
    if (!value.trim()) {
      setCaCertAction("keep")
      return
    }
    if (!value.includes("BEGIN CERTIFICATE")) return
    setIsParsing(true)
    try {
      const result = await ProxmoxConfigService.parseCert(value.trim())
      setCertInfo(result)
    } catch {
      setCertInfo({
        valid: false,
        fingerprint: null,
        subject: null,
        issuer: null,
        not_before: null,
        not_after: null,
        error: "解析失敗",
      })
    } finally {
      setIsParsing(false)
    }
  }

  const handleClearCert = () => {
    setCaCertInput("")
    setCertInfo(null)
    setCaCertAction("clear")
  }

  const buildConfigPayload = (data: ConfigFormData): ProxmoxConfigUpdate => {
    let ca_cert: string | null | undefined
    if (caCertAction === "replace") {
      ca_cert = caCertInput.trim() || null
    } else if (caCertAction === "clear") {
      ca_cert = ""
    } else {
      ca_cert = null
    }
    return {
      host: data.host,
      user: data.user,
      password: data.password || null,
      verify_ssl: data.verify_ssl,
      iso_storage: data.iso_storage,
      data_storage: data.data_storage,
      api_timeout: data.api_timeout,
      task_check_interval: data.task_check_interval,
      pool_name: data.pool_name,
      ca_cert,
      gateway_ip: data.gateway_ip || null,
      local_subnet: data.local_subnet || null,
      default_node: data.default_node || null,
    }
  }

  const saveMutation = useMutation({
    mutationFn: async ({ data }: { data: ConfigFormData }) => {
      await ProxmoxConfigService.updateConfig(buildConfigPayload(data))
    },
    onSuccess: () => {
      toast.success("Proxmox 設定已儲存")
      setTestResult(null)
      setCaCertInput("")
      setCertInfo(null)
      setCaCertAction("keep")
      setDialogOpen(false)
      setPendingFormData(null)
      setPreviewResult(null)
      queryClient.invalidateQueries({ queryKey: ["proxmoxConfig"] })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "儲存失敗，請稍後再試"
      toast.error(msg)
    },
  })

  const testMutation = useMutation({
    mutationFn: ProxmoxConfigService.testConnection,
    onSuccess: (result) => {
      setTestResult(result)
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
    },
    onError: () => toast.error("測試請求失敗"),
  })

  const syncNowMutation = useMutation({
    mutationFn: ProxmoxConfigService.syncNow,
    onSuccess: (result) => {
      if (result.success) {
        toast.success(
          `同步完成：${result.nodes.length} 個節點、${result.storage_count} 個 Storage`,
        )
        queryClient.invalidateQueries({ queryKey: ["proxmoxNodes"] })
        queryClient.invalidateQueries({ queryKey: ["proxmoxStorages"] })
      } else {
        toast.error(result.error ?? "同步失敗")
      }
    },
    onError: () => toast.error("同步請求失敗"),
  })

  const updateNodeMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: ProxmoxNodeUpdate }) =>
      ProxmoxConfigService.updateNode(id, body),
    onSuccess: () => {
      toast.success("節點設定已更新")
      setEditingNode(null)
      queryClient.invalidateQueries({ queryKey: ["proxmoxNodes"] })
    },
    onError: () => toast.error("節點更新失敗"),
  })

  const onSubmit = async (data: ConfigFormData) => {
    setIsPreviewing(true)
    try {
      const preview = await ProxmoxConfigService.previewCluster(
        buildConfigPayload(data),
      )
      if (!preview.success) {
        toast.error(`無法連線偵測節點：${preview.error}`)
        return
      }
      if (preview.is_cluster) {
        setPendingFormData(data)
        setPreviewResult(preview)
        setDialogOpen(true)
      } else {
        saveMutation.mutate({ data })
      }
    } catch {
      toast.error("偵測節點失敗，請確認設定後再試")
    } finally {
      setIsPreviewing(false)
    }
  }

  const handleConfirmSave = () => {
    if (!pendingFormData) return
    saveMutation.mutate({ data: pendingFormData })
  }

  const openEditNode = (node: ProxmoxNodePublic) => {
    setEditingNode(node)
    nodeForm.reset({
      host: node.host,
      port: node.port,
      priority: node.priority,
    })
  }

  const handleSaveNode = (data: NodeFormData) => {
    if (!editingNode?.id) return
    updateNodeMutation.mutate({
      id: editingNode.id,
      body: { host: data.host, port: data.port, priority: data.priority },
    })
  }

  const isSaving = saveMutation.isPending
  const isSubmitting = isPreviewing || isSaving

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PVE 主機設定</h1>
        <p className="text-muted-foreground">
          設定 Proxmox VE 主機的連線資訊，密碼將加密後儲存於資料庫。
        </p>
      </div>

      <Tabs defaultValue="connection">
        <TabsList>
          <TabsTrigger value="connection">連線設定</TabsTrigger>
          <TabsTrigger value="nodes">節點管理</TabsTrigger>
          <TabsTrigger value="storage">Storage 設定</TabsTrigger>
        </TabsList>

        {/* ── Tab: 連線設定 ─────────────────────────────────────── */}
        <TabsContent value="connection" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* 狀態卡片 */}
            <div className="flex flex-col gap-4 lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Server className="h-4 w-4" />
                    連線狀態
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    {configLoading ? (
                      <Badge variant="outline">載入中...</Badge>
                    ) : config?.is_configured ? (
                      <Badge className="bg-green-500 hover:bg-green-600">
                        已設定
                      </Badge>
                    ) : (
                      <Badge variant="destructive">未設定</Badge>
                    )}
                  </div>

                  {config?.is_configured && (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Server className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{config.host}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <User className="h-3.5 w-3.5 shrink-0" />
                        <span>{config.user}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <HardDrive className="h-3.5 w-3.5 shrink-0" />
                        <span>ISO: {config.iso_storage}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Database className="h-3.5 w-3.5 shrink-0" />
                        <span>資料: {config.data_storage}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Layers className="h-3.5 w-3.5 shrink-0" />
                        <span>集區: {config.pool_name}</span>
                      </div>
                      {config.gateway_ip && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Wifi className="h-3.5 w-3.5 shrink-0" />
                          <span>網關: {config.gateway_ip}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {config.has_ca_cert ? (
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-green-500" />
                        ) : (
                          <ShieldOff className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>
                          {config.has_ca_cert
                            ? "已設定 CA 憑證"
                            : "未設定 CA 憑證"}
                        </span>
                      </div>
                      {config.ca_fingerprint && (
                        <div className="rounded-md bg-muted p-2">
                          <p className="text-xs font-medium text-muted-foreground mb-1">
                            CA 指紋
                          </p>
                          <p className="break-all font-mono text-xs">
                            {config.ca_fingerprint}
                          </p>
                        </div>
                      )}
                      {config.updated_at && (
                        <p className="pt-1 text-xs text-muted-foreground">
                          最後更新：
                          {new Date(config.updated_at).toLocaleString("zh-TW")}
                        </p>
                      )}
                    </div>
                  )}

                  <Separator />

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={!config?.is_configured || testMutation.isPending}
                    onClick={() => testMutation.mutate()}
                  >
                    {testMutation.isPending ? (
                      <>
                        <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                        測試中...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                        測試連線
                      </>
                    )}
                  </Button>

                  {testResult && (
                    <div
                      className={`flex items-start gap-2 rounded-md p-3 text-sm ${
                        testResult.success
                          ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                          : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
                      }`}
                    >
                      {testResult.success ? (
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      <span>{testResult.message}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* 設定表單 */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">連線設定</CardTitle>
                <CardDescription>
                  {config?.is_configured
                    ? "更新 Proxmox 連線資訊。密碼欄位留空代表不更改。"
                    : "填寫 Proxmox VE 主機連線資訊以完成初始設定。"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-4"
                  >
                    <FormField
                      control={form.control}
                      name="host"
                      rules={{ required: "請輸入主機位址" }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            主機位址{" "}
                            <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="192.168.1.100 或 pve.example.com"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>
                            Proxmox VE 主機的 IP 或網域名稱（初始節點）
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="user"
                      rules={{ required: "請輸入 API 用戶" }}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            API 用戶{" "}
                            <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="root@pam" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            密碼{" "}
                            {!config?.is_configured && (
                              <span className="text-destructive">*</span>
                            )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder={
                                config?.is_configured
                                  ? "留空表示不更改"
                                  : "請輸入密碼"
                              }
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="iso_storage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>ISO Storage</FormLabel>
                            <FormControl>
                              <Input placeholder="local" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="data_storage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>資料 Storage</FormLabel>
                            <FormControl>
                              <Input placeholder="local-lvm" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="pool_name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>集區名稱</FormLabel>
                            <FormControl>
                              <Input placeholder="CampusCloud" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="verify_ssl"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center gap-3 space-y-0 pt-6">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">
                              驗證 SSL 憑證
                            </FormLabel>
                          </FormItem>
                        )}
                      />
                    </div>

                    <Separator />
                    <p className="text-sm font-medium">通用設定</p>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="gateway_ip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>網關地址（Gateway IP）</FormLabel>
                            <FormControl>
                              <Input placeholder="192.168.1.1" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="local_subnet"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>本地網段（Local Subnet）</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="192.168.1.0/24"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="default_node"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>預設建立節點</FormLabel>
                            <FormControl>
                              <Input placeholder="pve" {...field} />
                            </FormControl>
                            <FormDescription>
                              新 VM 優先建立於此節點
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="api_timeout"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>API 逾時（秒）</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={1}
                                max={300}
                                {...field}
                                onChange={(e) =>
                                  field.onChange(Number(e.target.value))
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="task_check_interval"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>任務輪詢間隔（秒）</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={1}
                                max={60}
                                {...field}
                                onChange={(e) =>
                                  field.onChange(Number(e.target.value))
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <Separator />
                    <p className="text-sm font-medium">CA 憑證（選填）</p>

                    {config?.has_ca_cert && caCertAction === "keep" && (
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <div className="flex items-center gap-2 text-sm">
                          <ShieldCheck className="h-4 w-4 text-green-500" />
                          <span>已設定 CA 憑證</span>
                          {config.ca_fingerprint && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {config.ca_fingerprint.slice(0, 23)}...
                            </span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleClearCert}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          清除
                        </Button>
                      </div>
                    )}

                    {caCertAction !== "keep" && (
                      <div className="space-y-2">
                        <Textarea
                          placeholder={
                            "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
                          }
                          className="font-mono text-xs"
                          rows={6}
                          value={caCertInput}
                          onChange={(e) => handleCertInput(e.target.value)}
                        />
                        {isParsing && (
                          <p className="text-xs text-muted-foreground">
                            解析中...
                          </p>
                        )}
                        {certInfo && (
                          <div
                            className={`rounded-md p-3 text-xs space-y-1 ${
                              certInfo.valid
                                ? "bg-green-50 dark:bg-green-950"
                                : "bg-red-50 dark:bg-red-950"
                            }`}
                          >
                            {certInfo.valid ? (
                              <>
                                <p>
                                  <span className="font-medium">指紋：</span>
                                  {certInfo.fingerprint}
                                </p>
                                <p>
                                  <span className="font-medium">主體：</span>
                                  {certInfo.subject}
                                </p>
                                <p>
                                  <span className="font-medium">有效期：</span>
                                  {certInfo.not_before} ~{" "}
                                  {certInfo.not_after}
                                </p>
                              </>
                            ) : (
                              <p className="text-red-700 dark:text-red-300">
                                <AlertTriangle className="inline h-3 w-3 mr-1" />
                                {certInfo.error}
                              </p>
                            )}
                          </div>
                        )}
                        {caCertAction === "clear" && !caCertInput && (
                          <p className="text-xs text-amber-600">
                            儲存後將清除現有 CA 憑證
                          </p>
                        )}
                      </div>
                    )}

                    {!config?.has_ca_cert && caCertAction === "keep" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCaCertAction("replace")}
                      >
                        <Lock className="mr-2 h-3.5 w-3.5" />
                        設定 CA 憑證
                      </Button>
                    )}

                    <div className="flex justify-end pt-2">
                      <LoadingButton
                        type="submit"
                        loading={isSubmitting}
                        disabled={isSubmitting}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        {isPreviewing
                          ? "偵測節點中..."
                          : isSaving
                            ? "儲存中..."
                            : "儲存設定"}
                      </LoadingButton>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Tab: 節點管理 ─────────────────────────────────────── */}
        <TabsContent value="nodes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4" />
                節點管理
                {!nodesLoading && nodes && (
                  <Badge variant="outline" className="ml-auto">
                    {nodes.length} 台
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                管理 Proxmox 叢集中的各節點連線設定。點擊「同步節點」自動從
                Proxmox 偵測所有節點與 Storage。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Button
                  variant="default"
                  disabled={
                    !config?.is_configured || syncNowMutation.isPending
                  }
                  onClick={() => syncNowMutation.mutate()}
                >
                  {syncNowMutation.isPending ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      同步中...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      同步節點
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    !config?.is_configured || testMutation.isPending
                  }
                  onClick={() => testMutation.mutate()}
                >
                  {testMutation.isPending ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      測試中...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      測試連線
                    </>
                  )}
                </Button>
              </div>

              {testResult && (
                <div
                  className={`flex items-start gap-2 rounded-md p-3 text-sm ${
                    testResult.success
                      ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                      : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}

              {nodesLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  載入中...
                </div>
              ) : !nodes || nodes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Server className="h-8 w-8" />
                  <p>尚無節點資料，請點擊「同步節點」。</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>節點名稱</TableHead>
                        <TableHead>主機位址</TableHead>
                        <TableHead>角色</TableHead>
                        <TableHead>狀態</TableHead>
                        <TableHead className="w-24">優先級</TableHead>
                        <TableHead className="w-20">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {nodes.map((node) => (
                        <TableRow key={node.id ?? node.name}>
                          <TableCell className="font-medium">
                            {node.name}
                          </TableCell>
                          <TableCell className="text-muted-foreground font-mono text-sm">
                            {node.host}:{node.port}
                          </TableCell>
                          <TableCell>
                            {node.is_primary ? (
                              <Badge variant="outline">主節點</Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">
                                副節點
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {node.is_online ? (
                                <Wifi className="h-3.5 w-3.5 text-green-500" />
                              ) : (
                                <WifiOff className="h-3.5 w-3.5 text-red-500" />
                              )}
                              <Badge
                                variant={
                                  node.is_online ? "default" : "destructive"
                                }
                                className={`text-xs ${node.is_online ? "bg-green-500 hover:bg-green-600" : ""}`}
                              >
                                {node.is_online ? "在線" : "離線"}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{node.priority}</Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditNode(node)}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab: Storage 設定 ─────────────────────────────────── */}
        <TabsContent value="storage" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" />
                Storage 設定
              </CardTitle>
              <CardDescription>
                設定各節點 Storage 的速度分級與優先級，供 VM 放置算法使用。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StorageTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── 多節點確認 Dialog ────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>偵測到叢集環境</DialogTitle>
            <DialogDescription>
              連線後偵測到以下 {previewResult?.nodes.length}{" "}
              個節點，確認後將儲存設定：
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {previewResult?.nodes.map((n) => (
              <div
                key={n.name}
                className="flex items-center justify-between rounded-md border p-2.5 text-sm"
              >
                <div>
                  <span className="font-medium">{n.name}</span>
                  {n.is_primary && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      主
                    </Badge>
                  )}
                </div>
                <span className="font-mono text-muted-foreground">
                  {n.host}:{n.port}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <LoadingButton loading={isSaving} onClick={handleConfirmSave}>
              確認儲存
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 節點編輯 Sheet ──────────────────────────────────────── */}
      <Sheet
        open={!!editingNode}
        onOpenChange={(open) => !open && setEditingNode(null)}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>編輯節點：{editingNode?.name}</SheetTitle>
            <SheetDescription>
              修改節點的連線資訊與優先級設定。節點名稱由 Proxmox
              決定，無法修改。
            </SheetDescription>
          </SheetHeader>
          <Form {...nodeForm}>
            <form
              onSubmit={nodeForm.handleSubmit(handleSaveNode)}
              className="flex flex-col gap-4 mt-6"
            >
              <FormField
                control={nodeForm.control}
                name="host"
                rules={{ required: "請輸入主機位址" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>主機位址</FormLabel>
                    <FormControl>
                      <Input placeholder="192.168.1.100" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={nodeForm.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API 埠號</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={nodeForm.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>優先級（1=最高，10=最低）</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      VM 放置算法會優先考慮優先級數字較小的節點
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <SheetFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingNode(null)}
                >
                  取消
                </Button>
                <LoadingButton
                  type="submit"
                  loading={updateNodeMutation.isPending}
                >
                  儲存
                </LoadingButton>
              </SheetFooter>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
