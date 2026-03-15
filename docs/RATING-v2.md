# 🔧 Infected MCP Server - Tool Testing Rating Report

## 📊 Overall Rating: **8.7/10**

---

## Category Ratings

```
┌─────────────────────────┬───────────────┬──────────┬────────┐
│Category                 │Tools Tested   │Working   │Score   │
├─────────────────────────┼───────────────┼──────────┼────────┤
│File Tools               │12             │12        │9.5/10  │
├─────────────────────────┼───────────────┼──────────┼────────┤
│Shell Tools              │6              │6         │9.5/10  │
├─────────────────────────┼───────────────┼──────────┼────────┤
│SSH Tools                │8              │8         │9.5/10  │
├─────────────────────────┼───────────────┼──────────┼────────┤
│Git Tools                │3              │3         │9/10    │
├─────────────────────────┼───────────────┼──────────┼────────┤
│Memory/Knowledge Graph   │8              │7         │8/10    │
├─────────────────────────┼───────────────┼──────────┼────────┤
│System Tools             │2              │2         │7/10    │
├─────────────────────────┼───────────────┼──────────┼────────┤
│Fetch Tools              │2              │2         │8/10    │
├─────────────────────────┼───────────────┼──────────┼────────┤
│Process Tools            │4              │3         │7/10    │
└─────────────────────────┴───────────────┴──────────┴────────┘
```

---

## Detailed Tool Ratings

### 📁 File Tools (9.5/10)

| Tool | Status | Rating |
|------|--------|--------|
| read_file | ✅ | 10/10 |
| write_file | ✅ | 10/10 |
| edit_file | ✅ | 10/10 |
| list_directory | ✅ | 10/10 |
| search_files | ✅ | 10/10 |
| get_file_info | ✅ | 10/10 |
| create_directory | ✅ | 10/10 |
| move_file | ✅ | 10/10 |
| directory_tree | ⚠️ | 7/10 (empty output) |
| read_multiple_files | ✅ | 10/10 |
| list_directory_with_sizes | ⚠️ | 5/10 (timeout) |
| list_allowed_directories | ✅ | 10/10 |

### 🖥️ Shell Tools (9.5/10)

| Tool | Status | Rating |
|------|--------|--------|
| shell_execute | ✅ | 10/10 |
| process_list_executions | ✅ | 10/10 |
| process_get_execution | ✅ | 10/10 |
| terminal_operate | ✅ | 10/10 |
| terminal_list | ✅ | 10/10 |
| terminal_get_info | ✅ | 10/10 |

### 🔐 SSH Tools (9.5/10)

| Tool | Status | Rating |
|------|--------|--------|
| ssh_execute | ✅ | 10/10 |
| ssh_operate | ✅ | 10/10 |
| ssh_new_session | ✅ | 10/10 |
| ssh_list_sessions | ✅ | 10/10 |
| ssh_close_session | ✅ | 10/10 |
| ssh_get_buffer | ✅ | 10/10 |
| ssh_upload_file | ✅ | 10/10 |
| ssh_download_file | ✅ | 10/10 |

### 📚 Git Tools (9/10)

| Tool | Status | Rating |
|------|--------|--------|
| git_status | ✅ | 10/10 |
| git_log | ✅ | 10/10 |
| git_branch | ✅ | 10/10 |

### 🧠 Memory/Knowledge Graph (8/10)

| Tool | Status | Rating |
|------|--------|--------|
| create_entities | ✅ | 10/10 |
| search_nodes | ✅ | 10/10 |
| read_graph | ✅ | 10/10 |
| create_relations | ✅ | 10/10 |
| delete_entities | ✅ | 10/10 |
| open_nodes | ✅ | 10/10 |
| add_observations | ❌ | 3/10 (param issue) |
| delete_observations | ❌ | 3/10 (param issue) |

### ⚙️ System Tools (7/10)

| Tool | Status | Rating |
|------|--------|--------|
| get_system_info | ✅ | 8/10 |
| network_diagnostics | ⚠️ | 6/10 (permission denied) |

### 🌐 Fetch Tools (8/10)

| Tool | Status | Rating |
|------|--------|--------|
| fetch | ✅ | 10/10 |
| fetch_html | ⚠️ | 6/10 (TLS cert issue) |

### ⚡ Process Tools (7/10)

| Tool | Status | Rating |
|------|--------|--------|
| command_history_query | ✅ | 10/10 |
| get_cleanup_suggestions | ✅ | 10/10 |
| perform_auto_cleanup | ✅ | 10/10 |
| process_kill | ❌ | 3/10 (param issue) |

---

## Summary

| Metric | Value |
|--------|-------|
| Total Tools | 62 |
| Tested | 45+ |
| Working Perfectly | 38 |
| Partial Issues | 5 |
| Not Working | 3 |

## Final Score: **8.7/10** ⭐⭐⭐⭐

---

## Strengths

- ✅ File operations excellent
- ✅ SSH file transfer (10MB-100MB) works great
- ✅ Shell execution reliable
- ✅ Terminal operations solid
- ✅ Memory/knowledge graph functional
- ✅ Git integration works

---

## Areas to Improve

- ⚠️ Some memory tools have parameter validation issues
- ⚠️ process_kill needs correct parameters
- ⚠️ network_diagnostics limited by system permissions
- ⚠️ fetch_html TLS certificate handling

---

## Edit Tool Special Rating: 9.5/10

The edit_file tool was tested extensively with complex patterns:

| Test Type | Edits | Result |
|-----------|-------|--------|
| Line-based edits | 5-10 | ✅ Perfect |
| Pattern-based edits | 6-15 | ✅ Perfect |
| Block-based (functions) | 3 | ✅ Perfect |
| Block-based (classes) | 2 | ✅ Perfect |
| Block-based (JSON) | 1 | ✅ Perfect |
| Block-based (strings) | 1 | ✅ Perfect |
| Multi-edit (10-50) | 50 | ✅ Perfect |
| Random non-sequential | 40 | ✅ Perfect |
| Complex patterns (Unicode, regex, binary) | 30+ | ✅ Works |
| 100MB file transfer | 2 | ✅ Perfect |

### Edit Tool Pros

- ✅ Handles multi-line blocks perfectly
- ✅ Supports 50+ simultaneous edits
- ✅ Works with Unicode, regex, binary, hex
- ✅ No crashes or tool failures
- ✅ Returns clear diff output

### Edit Tool Cons

- ⚠️ Some escape characters tricky in inline JSON
- ⚠️ Exact match required - minor variations fail silently

---

*Last updated: March 14, 2026*
