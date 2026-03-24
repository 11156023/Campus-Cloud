/**
 * 防火牆 API 服務
 *
 * 此檔案提供防火牆 API 的手動封裝，
 * 待後端 API 穩定後可透過 generate-client.sh 自動生成並取代。
 */

import type { CancelablePromise } from "@/client"
import { OpenAPI } from "@/client"
import { request as __request } from "@/client/core/request"

// ─── 型別定義 ──────────────────────────────────────────────────────────────────

export type PortSpec = {
  port: number
  protocol: "tcp" | "udp"
}

export type TopologyNode = {
  vmid: number | null
  name: string
  node_type: "vm" | "gateway"
  status: string | null
  ip_address: string | null
  firewall_enabled: boolean
  position_x: number
  position_y: number
}

export type TopologyEdge = {
  source_vmid: number | null
  target_vmid: number | null
  ports: PortSpec[]
  direction: "one_way" | "bidirectional"
}

export type TopologyResponse = {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

export type FirewallRulePublic = {
  pos: number
  type: string
  action: string
  source: string | null
  dest: string | null
  proto: string | null
  dport: string | null
  sport: string | null
  enable: number
  comment: string | null
  is_managed: boolean
}

export type FirewallOptionsPublic = {
  enable: boolean
  policy_in: string
  policy_out: string
}

export type LayoutNodeUpdate = {
  vmid: number | null
  node_type: "vm" | "gateway"
  position_x: number
  position_y: number
}

// ─── FirewallService ────────────────────────────────────────────────────────────

export class FirewallService {
  /** 取得拓撲資料（節點 + 連線） */
  public static getFirewallTopology(): CancelablePromise<TopologyResponse> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/firewall/topology",
      errors: { 422: "Validation Error" },
    })
  }

  /** 取得佈局資料 */
  public static getFirewallLayout(): CancelablePromise<LayoutNodeUpdate[]> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/firewall/layout",
      errors: { 422: "Validation Error" },
    })
  }

  /** 儲存佈局資料 */
  public static saveFirewallLayout(data: {
    requestBody: { nodes: LayoutNodeUpdate[] }
  }): CancelablePromise<{ message: string }> {
    return __request(OpenAPI, {
      method: "PUT",
      url: "/api/v1/firewall/layout",
      body: data.requestBody,
      mediaType: "application/json",
      errors: { 422: "Validation Error" },
    })
  }

  /** 建立連線 */
  public static createFirewallConnection(data: {
    requestBody: {
      source_vmid: number
      target_vmid: number | null
      ports: Array<{ port: number; protocol: string }>
      direction: string
    }
  }): CancelablePromise<{ message: string }> {
    return __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/firewall/connections",
      body: data.requestBody,
      mediaType: "application/json",
      errors: { 400: "Bad Request", 422: "Validation Error" },
    })
  }

  /** 刪除連線 */
  public static deleteFirewallConnection(data: {
    requestBody: {
      source_vmid: number
      target_vmid: number | null
      ports?: Array<{ port: number; protocol: string }> | null
    }
  }): CancelablePromise<{ message: string }> {
    return __request(OpenAPI, {
      method: "DELETE",
      url: "/api/v1/firewall/connections",
      body: data.requestBody,
      mediaType: "application/json",
      errors: { 422: "Validation Error" },
    })
  }

  /** 列出 VM 防火牆規則 */
  public static listFirewallRules(data: {
    vmid: number
  }): CancelablePromise<FirewallRulePublic[]> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/firewall/{vmid}/rules",
      path: { vmid: data.vmid },
      errors: { 422: "Validation Error" },
    })
  }

  /** 取得 VM 防火牆選項 */
  public static getFirewallOptions(data: {
    vmid: number
  }): CancelablePromise<FirewallOptionsPublic> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/firewall/{vmid}/options",
      path: { vmid: data.vmid },
      errors: { 422: "Validation Error" },
    })
  }

  /** 建立防火牆規則 */
  public static createFirewallRule(data: {
    vmid: number
    requestBody: {
      type: "in" | "out"
      action: "ACCEPT" | "DROP" | "REJECT"
      source?: string
      dest?: string
      proto?: string
      dport?: string
      enable?: number
      comment?: string
    }
  }): CancelablePromise<{ message: string }> {
    return __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/firewall/{vmid}/rules",
      path: { vmid: data.vmid },
      body: data.requestBody,
      mediaType: "application/json",
      errors: { 422: "Validation Error" },
    })
  }

  /** 刪除防火牆規則 */
  public static deleteFirewallRule(data: {
    vmid: number
    pos: number
  }): CancelablePromise<{ message: string }> {
    return __request(OpenAPI, {
      method: "DELETE",
      url: "/api/v1/firewall/{vmid}/rules/{pos}",
      path: { vmid: data.vmid, pos: data.pos },
      errors: { 422: "Validation Error" },
    })
  }
}
