# vLLM + Gemma 4 26B-A4B 推理加速與 Cache 優化檢查

## 目標

目前希望使用 **vLLM 部署 Gemma 4 26B-A4B**，並檢查是否能透過以下功能提升推理效能：

- Automatic Prefix Caching
- MTP / Speculative Decoding
- Async Scheduling
- Chunked Prefill
- FP8 KV Cache
- Continuous Batching
- MoE Kernel 優化
- vLLM 最新版本針對 Gemma 4 / Hybrid Attention 的優化

希望 Codex 可以根據目前實際環境與啟動參數，判斷：

1. 哪些功能已經啟用
2. 哪些功能可以安全開啟
3. 是否存在互相衝突或效能 regression
4. 如何改善：
   - TTFT
   - TPOT
   - 單使用者 tokens/s
   - 多使用者 throughput
   - KV Cache 使用率
   - Prefix Cache Hit Rate

---

# 模型資訊

預計模型：

```text
Gemma 4 26B-A4B
```

注意：

```text
26B = Total Parameters
A4B = 每個 token 約 4B active parameters
```

模型屬於：

```text
Mixture of Experts / MoE
```

並且 attention architecture 並非單純 Llama-style full attention，而是包含：

```text
Global Attention
+
Sliding Window Attention
```

因此在：

```text
KV Cache
Prefix Cache
Hybrid KV Cache
Speculative Decoding
```

方面，需要特別注意 vLLM 對 Hybrid Attention 的支援情況。

---

# 1. Automatic Prefix Caching

vLLM 支援：

```bash
--enable-prefix-caching
```

目的：

當不同 request 前面的 token 完全相同時，直接 reuse 已經計算完成的 KV Cache。

例如：

```text
Request A

[System Prompt]
[Character Prompt]
[Tools]
[Memory]
[Chat History]
[User Question A]
```

下一個 request：

```text
Request B

[System Prompt]
[Character Prompt]
[Tools]
[Memory]
[Chat History]
[User Question B]
```

如果前半段內容完全相同：

```text
System Prompt
Character Prompt
Tools
Memory
Chat History
```

就可以直接 reuse KV Cache。

---

## Prefix Cache 主要改善

主要改善：

```text
TTFT
Time To First Token
```

而不是直接提高：

```text
Decode Tokens/s
```

例如：

```text
System Prompt        4K
RAG / Memory         8K
Chat History        20K
New Prompt           1K

Total               33K
```

如果 32K 都可以 cache hit：

```text
實際需要重新 Prefill：

1K tokens
```

因此長對話、AI Agent、RAG workload 特別適合 Prefix Cache。

---

# 2. Prompt 結構需要配合 Prefix Cache

建議把：

```text
固定內容
```

盡量放在 prompt 前面。

例如：

```text
System Prompt
Character Definition
Tool Definitions
Static Memory
Shared Documents
Chat History
Dynamic Context
Current Time
Current User Prompt
```

不要把每次 request 都變化的資訊放太前面，例如：

```text
Current Time
Request ID
Random UUID
Current Token Usage
Dynamic User State
```

如果 token 很早就不同：

```text
Prefix Cache
```

後面的內容也無法命中。

---

# 3. Prefix Cache Metrics

需要檢查 vLLM `/metrics`。

例如：

```bash
curl http://localhost:8000/metrics | grep prefix
```

重點觀察：

```text
prefix_cache_queries
prefix_cache_hits
prompt_tokens_cached
kv_cache_usage
```

核心指標：

```text
Prefix Cache Hit Rate
```

可以概念化為：

```text
prefix_cache_hits
------------------
prefix_cache_queries
```

AI Agent / 長聊天 workload 如果 prompt 結構設計良好，希望能有：

```text
50%+
```

固定 System / Tool / Memory 很多時甚至可能：

```text
70%
80%
90%+
```

---

# 4. Gemma 4 Hybrid KV Cache

Gemma 4 使用：

```text
Sliding Window Attention
+
Global Attention
```

因此需要確認目前 vLLM 是否使用：

```text
Hybrid KV Cache Manager
```

近期 vLLM 已針對 Hybrid Model 改善：

```text
Partial Prefix Cache Hit

Selective Hybrid Cache Retention

Hybrid KV Cache Coordination

KV Cache Eviction / Retention
```

需要確認目前安裝版本是否包含這些更新。

---

# 5. MTP / Speculative Decoding

Prefix Cache 解決的是：

```text
Prefill
```

如果目標是改善：

```text
Decode speed
tokens/s
TPOT
```

更重要的是：

```text
Speculative Decoding
```

Gemma 4 有對應的 assistant / MTP model。

例如：

```text
google/gemma-4-26B-A4B-it-assistant
```

概念：

```text
Assistant Model

先預測：
Token A
Token B
Token C
Token D

        ↓

Main Gemma 4 Model
一次 Verify

A ✓
B ✓
C ✓
D ✓
```

而不是：

```text
Forward → Token A
Forward → Token B
Forward → Token C
Forward → Token D
```

因此理論上可以降低：

```text
TPOT
Time Per Output Token
```

---

# 6. Gemma 4 26B-A4B MTP 建議

目前可先從：

```text
num_speculative_tokens = 4
```

開始 benchmark。

例如：

```bash
--speculative-config \
'{
  "model": "google/gemma-4-26B-A4B-it-assistant",
  "num_speculative_tokens": 4
}'
```

建議比較：

```text
MTP OFF

vs

MTP = 2

vs

MTP = 4

vs

MTP = 6
```

觀察：

```text
Tokens/s
TPOT
TTFT
Acceptance Rate
GPU Utilization
Total Throughput
```

不要假設 speculative tokens 越高越快。

如果 draft acceptance rate 太低：

```text
Assistant 產生很多 token
        ↓
Target Model 不接受
        ↓
額外 computation 被浪費
        ↓
反而更慢
```

---

# 7. Prefix Cache + MTP

理論上兩者解決不同階段：

```text
Request
   │
   ▼
Prompt Prefill
   │
   ├── Prefix Cache
   │
   ▼
First Token
   │
   ▼
Token Decode
   │
   ├── MTP / Speculative Decoding
   │
   ▼
Output
```

也就是：

```text
Prefix Cache
↓
降低 TTFT

MTP
↓
降低 TPOT / 提升 Decode Speed
```

兩者理論上可以同時使用。

但需要特別 benchmark：

```text
Gemma 4
+
Hybrid KV Cache
+
Speculative Decoding
+
Prefix Caching
```

因為過去部分版本曾出現：

```text
Prefix Cache Hit Rate 異常下降

Hybrid KV Cache incompatibility

Speculative Decoding regression
```

所以不能只確認程式能啟動，需要實際測量。

---

# 8. Async Scheduling

建議測試：

```bash
--async-scheduling
```

主要目的：

讓：

```text
CPU Scheduler
```

和：

```text
GPU Execution
```

更有效 overlap。

比較適合：

```text
多 Request
高 Throughput
Continuous Batching
```

通常主要改善的是：

```text
Aggregate Throughput
```

不一定大幅增加單一 request tokens/s。

---

# 9. Chunked Prefill

建議：

```bash
--enable-chunked-prefill
```

主要用途：

避免一個非常大的 Prompt Prefill：

```text
50K
100K
128K
```

一次霸佔 GPU scheduler。

例如：

```text
Long Prompt Prefill
██████████████████████████████
```

拆成：

```text
██████
██████
██████
██████
██████
```

中間可以插入：

```text
Decode Request
Short Prompt
Other Users
```

對：

```text
Long Context
RAG
Agent
多人服務
```

特別有用。

---

# 10. FP8 KV Cache

可以測試：

```bash
--kv-cache-dtype fp8
```

主要用途不是直接提高：

```text
tokens/s
```

而是降低：

```text
KV Cache VRAM Usage
```

理論上 KV Cache memory 可以顯著下降。

效果：

```text
更長 Context
更多 Concurrent Requests
更大的 Batch
更少 KV Cache Preemption
```

因此屬於：

```text
Memory Optimization
↓
Indirect Throughput Improvement
```

---

# 11. Gemma 4 Weight Quantization

Gemma 4 26B-A4B 是 MoE。

需要特別注意：

```text
Expert Size
Expert Count
Quantization Backend
```

不要直接假設：

```text
W4A16
AWQ
GPTQ
```

一定會比 BF16 / INT8 快。

可考慮評估：

```text
int8_per_channel_weight_only
```

或硬體原生支援的：

```text
FP8
NVFP4
```

但具體最佳方案高度依賴 GPU：

```text
Ampere
Ada
Hopper
Blackwell
```

需要 Codex 根據實際硬體判斷。

---

# 12. MoE Kernel

Gemma 4 26B-A4B 屬於：

```text
MoE
```

因此效能不只取決於 attention。

需要檢查目前實際使用的：

```text
MoE Kernel Backend
```

可能包含：

```text
Triton
FlashInfer
CUTLASS
Marlin
DeepGEMM
其他 vLLM fused MoE kernel
```

需要確認：

```text
目前 GPU
+
目前 Quantization
+
目前 vLLM Version
```

實際選到的是哪個 backend。

避免：

```text
Fallback Kernel
```

導致 GPU utilization 很高但 tokens/s 不理想。

---

# 13. 建議 Baseline

先建立一個沒有 MTP 的 baseline：

```bash
vllm serve MODEL_NAME \
    --enable-prefix-caching \
    --enable-chunked-prefill \
    --async-scheduling \
    --gpu-memory-utilization 0.90 \
    --max-model-len 32768 \
    --max-num-batched-tokens 8192
```

請根據實際硬體調整：

```text
MODEL_NAME
max-model-len
max-num-batched-tokens
gpu-memory-utilization
tensor-parallel-size
```

---

# 14. 第二組：加入 MTP

```bash
vllm serve MODEL_NAME \
    --enable-prefix-caching \
    --enable-chunked-prefill \
    --async-scheduling \
    --gpu-memory-utilization 0.90 \
    --max-model-len 32768 \
    --max-num-batched-tokens 8192 \
    --speculative-config \
    '{
      "model": "google/gemma-4-26B-A4B-it-assistant",
      "num_speculative_tokens": 4
    }'
```

比較：

```text
Baseline
vs
MTP
```

---

# 15. 第三組：加入 FP8 KV Cache

```bash
vllm serve MODEL_NAME \
    --enable-prefix-caching \
    --enable-chunked-prefill \
    --async-scheduling \
    --kv-cache-dtype fp8 \
    --gpu-memory-utilization 0.90 \
    --max-model-len 32768 \
    --max-num-batched-tokens 8192
```

比較：

```text
BF16 KV

vs

FP8 KV
```

---

# 16. Benchmark 指標

不要只比較：

```text
tokens/s
```

需要同時紀錄：

## Latency

```text
TTFT
Time To First Token
```

```text
TPOT
Time Per Output Token
```

---

## Throughput

```text
Output Tokens / Second

Total Tokens / Second

Requests / Second
```

---

## Cache

```text
Prefix Cache Hit Rate

KV Cache Usage %

Cached Prompt Tokens
```

---

## GPU

```text
GPU Utilization

VRAM Usage

Memory Bandwidth

Power Usage
```

---

## Speculative Decoding

```text
Draft Tokens

Accepted Tokens

Acceptance Rate
```

---

# 17. 建議測試 Workload

至少測四組。

## Test A：完全不同 Prompt

```text
每次 prompt 都不同
```

用途：

測純模型效能。

---

## Test B：固定 System Prompt

例如：

```text
8K System Prompt
+
不同 User Prompt
```

用途：

測 Prefix Cache。

---

## Test C：長聊天

例如：

```text
32K Chat History
+
1K New Prompt
```

用途：

測：

```text
Prefix Cache
Hybrid KV Cache
TTFT
```

---

## Test D：多人併發

例如：

```text
1 user
4 users
8 users
16 users
32 users
```

用途：

測：

```text
Async Scheduling
Continuous Batching
Chunked Prefill
KV Capacity
```

---

# 18. Codex 請協助檢查

請根據目前環境檢查以下內容：

```text
1. vLLM 版本

2. Gemma 4 checkpoint 完整名稱

3. GPU 型號

4. GPU 數量

5. VRAM

6. CUDA Version

7. PyTorch Version

8. Triton Version

9. FlashAttention / FlashInfer Backend

10. Quantization Format

11. Attention Backend

12. MoE Backend

13. Prefix Cache 是否實際 Enabled

14. Chunked Prefill 是否 Enabled

15. Async Scheduling 是否 Enabled

16. Hybrid KV Cache Manager 是否正常使用

17. 是否支援 MTP Assistant Model

18. Speculative Decoding 是否與 Prefix Cache 衝突

19. KV Cache dtype

20. max_model_len

21. max_num_batched_tokens

22. max_num_seqs

23. gpu_memory_utilization

24. tensor_parallel_size

25. cudagraph 是否啟用

26. 是否存在 fallback kernel

27. 是否有 Gemma 4 相關 warning

28. 是否有 deprecated CLI argument
```

---

# 19. 希望 Codex 最後輸出

請最後整理成：

```text
目前設定
↓
發現問題
↓
可能的效能瓶頸
↓
建議修改
↓
建議 vLLM 啟動指令
↓
Benchmark 方法
```

並分成兩套設定。

## A. 單使用者低延遲

優先：

```text
低 TTFT
低 TPOT
高單 request tokens/s
```

---

## B. 多使用者高吞吐

優先：

```text
高 Aggregate Throughput
高 KV Utilization
高 Prefix Cache Hit
高 Continuous Batching Efficiency
```

---

# 整體優化優先順序

目前優先建議測試：

```text
1. Automatic Prefix Caching

2. Async Scheduling

3. MTP / Speculative Decoding

4. Chunked Prefill

5. FP8 KV Cache

6. max-num-batched-tokens 調整

7. max-num-seqs 調整

8. MoE Kernel / Quantization Backend

9. CUDA Graph / Compilation Optimization
```

不要一開始同時修改所有參數。

推薦：

```text
建立 Baseline
↓
一次修改一個變數
↓
Benchmark
↓
保留有效設定
↓
再測下一個設定
```

最重要的是分清楚三種不同效能問題：

```text
Prefill 慢
→ Prefix Cache / Chunked Prefill

Decode 慢
→ MTP / Kernel / Quantization

多人吞吐低
→ Async Scheduling / Continuous Batching / KV Capacity
```