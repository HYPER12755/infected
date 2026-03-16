# Error Codes Reference

Complete reference of all 46+ standardized error codes grouped by category, with descriptions, occurrence conditions, suggested actions, and retry status.

## NETWORK Category (7 codes)

Network errors represent communication failures between services or systems.

### NET_CONN_TIMEOUT

**Description:** Connection timeout to remote host

**Occurs When:**
- TCP connection cannot be established within timeout period
- Network latency exceeds configured timeout
- Firewall blocking connection
- Remote service not responding

**Suggested Action:**
- Verify network connectivity: `ping <host>`
- Check firewall rules: `netstat -an | grep <port>`
- Verify remote service is running
- Increase timeout if network is slow but working
- Check DNS resolution: `nslookup <host>`

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new NetworkError('Connection timeout to database', {
  code: NetworkErrorCode.CONNECTION_TIMEOUT,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    host: 'db.example.com',
    port: 5432,
    timeout: 30000,
    elapsed: 30150,
  },
  suggestedAction: 'Check database connectivity and network latency',
});
```

**Recovery Strategy:** RetryStrategy with exponential backoff, default 3-5 attempts

---

### NET_DNS_FAILURE

**Description:** DNS resolution failure for hostname

**Occurs When:**
- DNS server unavailable or not responding
- Hostname does not exist
- DNS query timeout
- Invalid hostname format
- DNS cache entry expired and refresh failed

**Suggested Action:**
- Verify hostname spelling: `nslookup <hostname>`
- Check DNS configuration: `cat /etc/resolv.conf`
- Verify DNS server is reachable: `ping <dns-server>`
- Wait and retry (transient DNS issues)
- Check for DNS configuration in /etc/hosts

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new NetworkError('DNS resolution failed', {
  code: NetworkErrorCode.DNS_FAILURE,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    hostname: 'api.example.com',
    dnsServer: '8.8.8.8',
    error: 'ENOTFOUND',
  },
  suggestedAction: 'Verify hostname and DNS configuration',
});
```

**Recovery Strategy:** RetryStrategy with longer delays, suitable for waiting on DNS propagation

---

### NET_CONN_REFUSED

**Description:** Connection refused by remote host

**Occurs When:**
- Remote port is closed/not listening
- Remote service crashed or not started
- Remote service too busy to accept connections
- Incorrect port number
- Service listening on different interface

**Suggested Action:**
- Verify remote service is running: `telnet <host> <port>`
- Check service logs for errors
- Verify correct port number
- Check service configuration for correct bind address
- Restart remote service if applicable

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new NetworkError('Connection refused by server', {
  code: NetworkErrorCode.CONNECTION_REFUSED,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    host: '192.168.1.100',
    port: 8080,
    error: 'ECONNREFUSED',
  },
  suggestedAction: 'Verify service is running on correct port',
});
```

**Recovery Strategy:** RetryStrategy, service may be starting up

---

### NET_UNREACHABLE

**Description:** Network unreachable to destination

**Occurs When:**
- Network path to destination does not exist
- Routing rules block destination
- Host is on different network segment and no route
- Network interface down
- Firewall blocks at network layer

**Suggested Action:**
- Check routing table: `route -n`
- Verify network interface is up: `ip link show`
- Check network connectivity: `ping <gateway>`
- Verify firewall rules: `iptables -L`
- Check network configuration: `ip route show`

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new NetworkError('Network unreachable', {
  code: NetworkErrorCode.UNREACHABLE,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    destination: '10.0.0.1',
    sourceInterface: 'eth0',
    error: 'ENETUNREACH',
  },
  suggestedAction: 'Check routing and network configuration',
});
```

**Recovery Strategy:** RetryStrategy with longer delays

---

### NET_RESET

**Description:** Connection reset by peer

**Occurs When:**
- Remote host forcefully closed connection
- Network path interrupted unexpectedly
- TCP RST packet received
- Remote application crashed
- Connection idle timeout on remote side

**Suggested Action:**
- Check remote service logs
- Verify network stability with continuous ping
- Check for firewall rules resetting connections
- Increase keep-alive timeouts
- Review remote service configuration

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new NetworkError('Connection reset by remote host', {
  code: NetworkErrorCode.RESET,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    host: 'api.example.com',
    port: 443,
    bytesTransferred: 1024,
  },
  suggestedAction: 'Verify network stability and remote service health',
});
```

**Recovery Strategy:** RetryStrategy with exponential backoff

---

### NET_KEEP_ALIVE_TIMEOUT

**Description:** TCP keep-alive timeout

**Occurs When:**
- Connection idle for too long
- Keep-alive packets not received from peer
- Network does not support long-lived connections
- Firewall closing idle connections

**Suggested Action:**
- Reduce keep-alive interval
- Implement application-level keep-alive
- Check firewall idle connection timeout settings
- Monitor connection activity and reestablish if idle

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new NetworkError('Keep-alive timeout', {
  code: NetworkErrorCode.KEEP_ALIVE_TIMEOUT,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    keepAliveInterval: 30000,
    idleTime: 60000,
  },
  suggestedAction: 'Reduce keep-alive interval or reconnect periodically',
});
```

**Recovery Strategy:** RetryStrategy, typically results in new connection

---

### NET_PROTOCOL_ERROR

**Description:** Protocol violation in communication

**Occurs When:**
- Invalid response format received
- Protocol version mismatch
- Malformed data received
- Unexpected message type
- Encryption/compression error

**Suggested Action:**
- Verify protocol version compatibility
- Check for proxy/intermediary issues
- Enable protocol debugging/logging
- Verify SSL/TLS certificates if using HTTPS
- Review application protocol implementation

**Retryable:** Sometimes (depends on context)

**Severity:** HIGH

**Example:**
```typescript
throw new NetworkError('Protocol error in response', {
  code: NetworkErrorCode.PROTOCOL_ERROR,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    protocol: 'HTTP/2',
    error: 'Invalid frame header',
    expectedFormat: 'JSON',
    receivedData: 'corrupted',
  },
  suggestedAction: 'Verify protocol compatibility and data integrity',
});
```

**Recovery Strategy:** RetryStrategy with circuit breaker

---

## PROCESS Category (7 codes)

Process errors represent failures in spawning and executing child processes.

### PROC_SPAWN_FAILED

**Description:** Failed to spawn process

**Occurs When:**
- Executable file not found
- Insufficient permissions to execute
- Out of file descriptors
- Out of memory for new process
- Process limit exceeded

**Suggested Action:**
- Verify executable exists and is in PATH
- Check file permissions: `ls -l <executable>`
- Check ulimits: `ulimit -a`
- Check available memory: `free -h`
- Check process count: `ps aux | wc -l`

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new ProcessError('Failed to spawn npm process', {
  code: ProcessErrorCode.SPAWN_FAILED,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    command: 'npm',
    args: ['test'],
    error: 'ENOENT',
  },
  suggestedAction: 'Verify npm is installed and in PATH',
});
```

**Recovery Strategy:** None - requires manual fix

---

### PROC_EXIT_CODE

**Description:** Process exited with non-zero exit code

**Occurs When:**
- Application logic error
- Test failures
- Command execution failure
- Unhandled exception in process
- Missing dependencies

**Suggested Action:**
- Review process exit code documentation
- Check process stderr/stdout logs
- Run process manually to reproduce error
- Verify all dependencies are installed
- Add error logging to process

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new ProcessError('npm test exited with code 1', {
  code: ProcessErrorCode.EXIT_CODE,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    exitCode: 1,
    command: 'npm test',
    stderr: 'Test suite failed',
  },
  suggestedAction: 'Review test output and fix failing tests',
});
```

**Recovery Strategy:** Manual intervention required

---

### PROC_SIGNAL_RECEIVED

**Description:** Process killed by signal

**Occurs When:**
- SIGTERM/SIGKILL received
- Process hit resource limit (SIGKILL)
- Timeout handler killed process
- Manual kill command executed
- System shutdown/reboot

**Suggested Action:**
- Check for timeout handlers
- Verify resource limits
- Check system logs for termination signals
- Implement graceful shutdown handling
- Review process monitoring configuration

**Retryable:** Sometimes

**Severity:** HIGH

**Example:**
```typescript
throw new ProcessError('Process killed by SIGTERM', {
  code: ProcessErrorCode.SIGNAL_RECEIVED,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    signal: 'SIGTERM',
    reason: 'timeout',
  },
  suggestedAction: 'Investigate process timeout and optimize execution',
});
```

**Recovery Strategy:** RetryStrategy with longer timeout

---

### PROC_TIMEOUT

**Description:** Process execution timeout

**Occurs When:**
- Process took longer than configured timeout
- Infinite loop or deadlock in process
- Resource contention making process slow
- Long-running operation without progress reporting

**Suggested Action:**
- Profile process to find slow operations: `time <command>`
- Optimize slow operations
- Increase timeout if appropriate
- Add progress reporting and monitoring
- Consider breaking into smaller operations

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new ProcessError('Process execution timeout after 30s', {
  code: ProcessErrorCode.TIMEOUT,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    timeout: 30000,
    elapsed: 30100,
    command: 'npm test',
  },
  suggestedAction: 'Profile process and optimize slow operations',
});
```

**Recovery Strategy:** RetryStrategy with increased timeout

---

### PROC_NOT_FOUND

**Description:** Process executable not found

**Occurs When:**
- Executable not in PATH
- Executable file deleted or moved
- Incorrect executable name
- Shell cannot find executable

**Suggested Action:**
- Verify executable exists: `which <command>`
- Add directory to PATH if needed
- Use absolute path to executable
- Verify file permissions: `ls -l <path>`
- Install missing application

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new ProcessError('npm executable not found', {
  code: ProcessErrorCode.NOT_FOUND,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    command: 'npm',
    path: process.env.PATH,
  },
  suggestedAction: 'Install npm or add node_modules/.bin to PATH',
});
```

**Recovery Strategy:** None - requires installation

---

### PROC_PERM_DENIED

**Description:** Permission denied executing process

**Occurs When:**
- File not executable (missing x permission)
- User does not have execute permission
- SELinux/AppArmor policy prevents execution
- Script missing shebang line

**Suggested Action:**
- Add execute permission: `chmod +x <file>`
- Verify user ownership and permissions
- Check SELinux context: `ls -Z <file>`
- Add shebang to script: `#!/bin/bash`
- Check parent directory permissions

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new ProcessError('Permission denied executing script', {
  code: ProcessErrorCode.PERMISSION_DENIED,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    file: './deploy.sh',
    currentPermissions: '-rw-r--r--',
    requiredPermissions: '-rwxr-xr-x',
  },
  suggestedAction: 'Add execute permission: chmod +x ./deploy.sh',
});
```

**Recovery Strategy:** None - requires permission fix

---

### PROC_INVALID_ARGS

**Description:** Invalid process arguments

**Occurs When:**
- Wrong number of arguments
- Invalid argument format
- Unknown command-line flag
- Conflicting arguments
- Argument value out of range

**Suggested Action:**
- Review command documentation: `<command> --help`
- Verify argument count and order
- Check argument format and type
- Validate argument values
- Review command-line parsing logic

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new ProcessError('Invalid arguments for npm command', {
  code: ProcessErrorCode.INVALID_ARGS,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    command: 'npm',
    args: ['invalid-command'],
    error: 'Unknown command "invalid-command"',
  },
  suggestedAction: 'Review npm documentation and fix command arguments',
});
```

**Recovery Strategy:** None - requires correct arguments

---

## SSH Category (7 codes)

SSH errors represent failures in secure shell protocol operations.

### SSH_AUTH_FAILED

**Description:** SSH authentication failure

**Occurs When:**
- Wrong password or key
- Key not in authorized_keys
- User does not exist
- SSH server rejects auth method
- Key permissions incorrect (600)

**Suggested Action:**
- Verify credentials are correct
- Check authorized_keys contains public key: `cat ~/.ssh/authorized_keys`
- Fix key permissions: `chmod 600 ~/.ssh/id_rsa`
- Verify username exists on remote
- Check SSH server configuration for allowed auth methods

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new SSHError('SSH authentication failed', {
  code: SSHErrorCode.AUTH_FAILED,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    host: 'server.example.com',
    user: 'deploy',
    authMethod: 'publicKey',
    keyPath: '/home/deploy/.ssh/id_rsa',
  },
  suggestedAction: 'Verify SSH key and add to authorized_keys on remote',
});
```

**Recovery Strategy:** None - requires correct credentials

---

### SSH_CONN_FAILED

**Description:** SSH connection failure

**Occurs When:**
- SSH server not responding
- Port 22 blocked by firewall
- SSH server crashed
- SSH service not running
- Network unreachable

**Suggested Action:**
- Verify SSH server is running: `systemctl status ssh`
- Check if port is open: `netstat -an | grep 22`
- Verify firewall allows SSH: `iptables -L`
- Check network connectivity: `ping <host>`
- Review SSH server logs

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new SSHError('Failed to connect to SSH server', {
  code: SSHErrorCode.CONNECTION_FAILED,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    host: 'server.example.com',
    port: 22,
  },
  suggestedAction: 'Verify SSH server is running and accessible',
});
```

**Recovery Strategy:** RetryStrategy with exponential backoff

---

### SSH_CMD_FAILED

**Description:** Remote command execution failure

**Occurs When:**
- Command not found on remote
- Command exited with error
- Command lacks permissions
- Shell syntax error in command
- Remote environment issue

**Suggested Action:**
- Verify command exists on remote: `ssh <host> which <command>`
- Test command manually on remote
- Check command permissions
- Verify required tools/dependencies installed remotely
- Check remote shell environment

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new SSHError('Remote command failed', {
  code: SSHErrorCode.COMMAND_FAILED,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    host: 'server.example.com',
    command: 'npm start',
    exitCode: 127,
    stderr: 'command not found',
  },
  suggestedAction: 'Install npm on remote or use absolute path',
});
```

**Recovery Strategy:** Manual intervention

---

### SSH_TIMEOUT

**Description:** SSH operation timeout

**Occurs When:**
- SSH handshake took too long
- Remote server not responding during operation
- Network latency very high
- SSH server stuck processing

**Suggested Action:**
- Increase SSH timeout in config
- Check network latency: `ping -c 10 <host>`
- Verify SSH server not overloaded
- Check SSH server logs
- Try direct connection without proxy

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new SSHError('SSH operation timeout', {
  code: SSHErrorCode.TIMEOUT,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    host: 'server.example.com',
    timeout: 30000,
    stage: 'authentication',
  },
  suggestedAction: 'Increase timeout or check network latency',
});
```

**Recovery Strategy:** RetryStrategy with longer delays

---

### SSH_HOST_KEY_VERIFY

**Description:** Host key verification failure

**Occurs When:**
- Host key not in known_hosts
- Host key changed unexpectedly
- MITM attack detected
- Host key format unsupported
- SSH server changed keys

**Suggested Action:**
- Verify host identity before accepting
- Accept and cache host key: `ssh-keyscan -H <host> >> ~/.ssh/known_hosts`
- Check for host key tampering: `ssh-keygen -l -F <host>`
- Verify SSH server identity out-of-band
- Contact SSH server administrator if key changed

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new SSHError('Host key verification failed', {
  code: SSHErrorCode.HOST_KEY_VERIFICATION,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    host: 'server.example.com',
    fingerprint: 'SHA256:...',
    reason: 'Host key changed',
  },
  suggestedAction: 'Verify host identity and update known_hosts',
});
```

**Recovery Strategy:** Manual verification required

---

### SSH_CHANNEL_OPEN_FAIL

**Description:** SSH channel open failure

**Occurs When:**
- SSH server refused to open channel
- Maximum channels exceeded on server
- SSH server resource limit reached
- Channel type not supported
- Session type conflict

**Suggested Action:**
- Check SSH server resource limits
- Wait and retry (temporary channel limits)
- Reduce parallel SSH connections
- Verify SSH server supports required channel type
- Review SSH server configuration

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new SSHError('Failed to open SSH channel', {
  code: SSHErrorCode.CHANNEL_OPEN_FAILURE,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    host: 'server.example.com',
    channelType: 'session',
    error: 'Resource shortage',
  },
  suggestedAction: 'Reduce parallel connections and retry',
});
```

**Recovery Strategy:** RetryStrategy with exponential backoff

---

### SSH_DISCONNECTED

**Description:** SSH connection unexpectedly disconnected

**Occurs When:**
- Remote server disconnected while command running
- Network disconnected during transfer
- Keep-alive timeout on remote
- Remote server crashed
- SSH session exceeded max lifetime

**Suggested Action:**
- Check network stability
- Review remote server logs
- Verify SSH keep-alive settings
- Check for session timeouts in SSH config
- Implement reconnection logic

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new SSHError('SSH connection disconnected', {
  code: SSHErrorCode.DISCONNECTED,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    host: 'server.example.com',
    connectedTime: 120000,
  },
  suggestedAction: 'Check network stability and retry connection',
});
```

**Recovery Strategy:** RetryStrategy with reconnection

---

## RESOURCE Category (6 codes)

Resource errors represent exhaustion of system resources.

### RES_MEMORY_EXCEEDED

**Description:** Memory limit exceeded

**Occurs When:**
- Heap size exceeded Java heap limit
- Node.js heap exceeded --max-old-space-size
- Process exceeded container memory limit
- OOM killer triggered
- Memory leak in application

**Suggested Action:**
- Increase available memory: `--max-old-space-size=4096`
- Reduce batch/chunk size for processing
- Identify memory leaks: `node --inspect --expose-gc`
- Enable garbage collection logging
- Monitor memory usage with `top` or `node-clinic`

**Retryable:** Yes (after cleanup)

**Severity:** CRITICAL

**Example:**
```typescript
throw new ResourceError('Memory limit exceeded', {
  code: ResourceErrorCode.MEMORY_EXCEEDED,
  severity: ErrorSeverity.CRITICAL,
  retryable: true,
  context: {
    available: 512,
    required: 1024,
    unit: 'MB',
    heapUsed: 987,
    heapTotal: 1024,
  },
  suggestedAction: 'Reduce batch size or increase available memory',
});
```

**Recovery Strategy:** RetryStrategy with cleanup handler, circuit breaker for cascading

---

### RES_CPU_LIMIT

**Description:** CPU limit exceeded

**Occurs When:**
- CPU utilization at 100%
- CPU quota exceeded in container
- Too many concurrent operations
- CPU-intensive operation running
- Inefficient algorithm causing CPU spike

**Suggested Action:**
- Reduce concurrent operations
- Optimize CPU-intensive code
- Profile CPU usage: `perf stat <command>`
- Distribute load across multiple processes/machines
- Use time-based scheduling to spread work

**Retryable:** No (except with load distribution)

**Severity:** CRITICAL

**Example:**
```typescript
throw new ResourceError('CPU limit exceeded', {
  code: ResourceErrorCode.CPU_LIMIT,
  severity: ErrorSeverity.CRITICAL,
  retryable: false,
  context: {
    cpuUsage: 100,
    cpuLimit: 100,
    activeThreads: 32,
  },
  suggestedAction: 'Reduce concurrent load or optimize algorithms',
});
```

**Recovery Strategy:** Load balancing, task queue

---

### RES_FH_EXCEEDED

**Description:** File handle limit exceeded

**Occurs When:**
- ulimit -n exceeded
- Too many open files
- File handles not closed properly (leak)
- Container fd limit exceeded
- Network connections not closed

**Suggested Action:**
- Increase ulimit: `ulimit -n 65536`
- Check for open files: `lsof -p <pid>`
- Implement proper resource cleanup
- Monitor fd usage
- Close files/sockets when done

**Retryable:** Yes (after cleanup)

**Severity:** CRITICAL

**Example:**
```typescript
throw new ResourceError('File handle limit exceeded', {
  code: ResourceErrorCode.FILE_HANDLES_EXCEEDED,
  severity: ErrorSeverity.CRITICAL,
  retryable: true,
  context: {
    currentLimit: 1024,
    inUse: 1024,
    openConnections: 512,
  },
  suggestedAction: 'Close unused files/sockets and increase ulimit',
});
```

**Recovery Strategy:** RetryStrategy with cleanup

---

### RES_DISK_FULL

**Description:** Disk space full

**Occurs When:**
- Disk partition 100% full
- Cannot write files
- Cannot create swap/temp files
- Log files consuming all space
- Old backups not cleaned up

**Suggested Action:**
- Check disk usage: `df -h`
- Clean up old files and logs
- Remove temporary files: `rm -rf /tmp/*`
- Archive old data
- Add more disk space

**Retryable:** No

**Severity:** CRITICAL

**Example:**
```typescript
throw new ResourceError('Disk full', {
  code: ResourceErrorCode.DISK_FULL,
  severity: ErrorSeverity.CRITICAL,
  retryable: false,
  context: {
    filesystem: '/dev/sda1',
    total: 100,
    used: 100,
    available: 0,
    unit: 'GB',
  },
  suggestedAction: 'Free up disk space or add additional storage',
});
```

**Recovery Strategy:** Manual intervention required

---

### RES_NOT_AVAILABLE

**Description:** Required resource not available

**Occurs When:**
- Database connection pool exhausted
- Thread pool exhausted
- Worker process limit reached
- Required service unavailable
- Resource allocation failed

**Suggested Action:**
- Wait for resource to become available
- Increase resource pool size
- Reduce concurrent resource usage
- Implement resource queueing
- Check for resource leaks

**Retryable:** Yes

**Severity:** HIGH

**Example:**
```typescript
throw new ResourceError('Database connection pool exhausted', {
  code: ResourceErrorCode.NOT_AVAILABLE,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    poolSize: 10,
    inUse: 10,
    waitingConnections: 15,
  },
  suggestedAction: 'Increase connection pool or reduce concurrent queries',
});
```

**Recovery Strategy:** RetryStrategy with queue

---

### RES_QUOTA_EXCEEDED

**Description:** Quota limit exceeded

**Occurs When:**
- API rate limit exceeded
- Subscription quota exceeded
- Storage quota for user/account exceeded
- Request count quota exceeded
- Upload size quota exceeded

**Suggested Action:**
- Wait for quota reset period
- Optimize resource usage to reduce quota consumption
- Upgrade subscription if available
- Implement request batching to use quota efficiently
- Review quota usage analytics

**Retryable:** Yes (after waiting)

**Severity:** HIGH

**Example:**
```typescript
throw new ResourceError('API quota exceeded', {
  code: ResourceErrorCode.QUOTA_EXCEEDED,
  severity: ErrorSeverity.HIGH,
  retryable: true,
  context: {
    quotaLimit: 1000,
    used: 1000,
    resetTime: '2024-03-17T00:00:00Z',
  },
  suggestedAction: 'Wait for quota reset or upgrade plan',
});
```

**Recovery Strategy:** RetryStrategy with extended delay until reset

---

## SECURITY Category (6 codes)

Security errors represent authentication, authorization, and validation failures.

### SEC_VALIDATION_FAILED

**Description:** Input validation failure

**Occurs When:**
- Required field missing
- Field format invalid
- Field value out of acceptable range
- Data type mismatch
- Custom validation rule failed

**Suggested Action:**
- Review validation rules
- Verify input data format
- Check field types and lengths
- Review error details for specific validation failure
- Update input to comply with validation

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new SecurityError('Validation failed', {
  code: SecurityErrorCode.VALIDATION_FAILED,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    field: 'email',
    value: 'invalid-email',
    error: 'Invalid email format',
  },
  suggestedAction: 'Provide valid email address',
});
```

**Recovery Strategy:** User input correction required

---

### SEC_POLICY_VIOLATION

**Description:** Security policy violation

**Occurs When:**
- Requested operation violates security policy
- User attempting forbidden action
- Access control policy denies operation
- Resource usage policy exceeded
- Compliance requirement violated

**Suggested Action:**
- Review security policies
- Verify user has necessary permissions
- Check for policy misconfiguration
- Contact security team if policy unclear
- Request policy exception if appropriate

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new SecurityError('Policy violation', {
  code: SecurityErrorCode.POLICY_VIOLATION,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    policy: 'ip-whitelist',
    userIp: '192.168.1.1',
    allowedIps: ['10.0.0.0/8'],
  },
  suggestedAction: 'Contact administrator to whitelist IP address',
});
```

**Recovery Strategy:** Administrative action required

---

### SEC_UNAUTHORIZED

**Description:** Authentication required but not provided or invalid

**Occurs When:**
- No auth token/credentials provided
- Auth token expired
- Auth token invalid or malformed
- Session expired
- User not logged in

**Suggested Action:**
- Log in to obtain credentials
- Refresh authentication token
- Check token expiration
- Verify token is correctly formatted
- Retry after re-authentication

**Retryable:** No (requires user action)

**Severity:** HIGH

**Example:**
```typescript
throw new SecurityError('Unauthorized', {
  code: SecurityErrorCode.UNAUTHORIZED,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    reason: 'Missing authentication token',
    endpoint: '/api/private/data',
  },
  suggestedAction: 'Provide valid authentication credentials',
});
```

**Recovery Strategy:** User re-authentication required

---

### SEC_FORBIDDEN

**Description:** Access forbidden - authenticated but not authorized

**Occurs When:**
- User lacks required permissions
- Resource access denied for user role
- Resource ownership mismatch
- Account suspended or disabled
- Feature not available for user tier

**Suggested Action:**
- Verify user has necessary permissions
- Check resource access control lists
- Verify user account is active
- Request permission upgrade if needed
- Contact resource owner for access

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new SecurityError('Forbidden', {
  code: SecurityErrorCode.FORBIDDEN,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    userId: 'user123',
    resource: '/admin/settings',
    requiredRole: 'admin',
    userRole: 'user',
  },
  suggestedAction: 'Contact administrator to request access',
});
```

**Recovery Strategy:** Permission escalation required

---

### SEC_INVALID_SIG

**Description:** Cryptographic signature validation failed

**Occurs When:**
- Message signature invalid
- Signature verification failed
- Wrong signing key used
- Message modified after signing
- Signature algorithm mismatch

**Suggested Action:**
- Verify correct signing key used
- Check message integrity
- Verify signature algorithm matches
- Check key rotation hasn't broken compatibility
- Review cryptographic implementation

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new SecurityError('Invalid signature', {
  code: SecurityErrorCode.INVALID_SIGNATURE,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    algorithm: 'sha256',
    expectedSig: 'abc123...',
    providedSig: 'xyz789...',
  },
  suggestedAction: 'Verify message integrity and signing key',
});
```

**Recovery Strategy:** None - data integrity issue

---

### SEC_CERT_INVALID

**Description:** Certificate validation failed

**Occurs When:**
- Certificate expired
- Certificate not trusted
- Certificate hostname mismatch
- Certificate revoked
- Self-signed certificate without trust

**Suggested Action:**
- Update certificate if expired
- Add CA certificate to trust store
- Verify certificate hostname matches
- Check certificate revocation list
- Install CA bundle from system

**Retryable:** No

**Severity:** HIGH

**Example:**
```typescript
throw new SecurityError('Invalid certificate', {
  code: SecurityErrorCode.CERTIFICATE_INVALID,
  severity: ErrorSeverity.HIGH,
  retryable: false,
  context: {
    hostname: 'api.example.com',
    certHostname: 'old.example.com',
    expiration: '2024-01-01',
    reason: 'Hostname mismatch',
  },
  suggestedAction: 'Update certificate with correct hostname',
});
```

**Recovery Strategy:** Certificate renewal required

---

## TIMEOUT Category (5 codes)

Timeout errors represent operations that exceeded time limits.

### TIMEOUT_OPERATION

**Description:** Generic operation timeout

**Occurs When:**
- Operation exceeded configured timeout
- Operation took longer than expected
- External service response time exceeded limit
- No progress indication for extended period

**Suggested Action:**
- Increase timeout if operation is legitimately slow
- Optimize operation to complete faster
- Break operation into smaller chunks
- Implement progress reporting
- Use async/streaming for large operations

**Retryable:** Yes

**Severity:** MEDIUM

**Example:**
```typescript
throw new TimeoutError('Operation timeout', {
  code: TimeoutErrorCode.OPERATION_TIMEOUT,
  severity: ErrorSeverity.MEDIUM,
  retryable: true,
  context: {
    operation: 'fetchLargeDataset',
    timeout: 30000,
    elapsed: 30150,
  },
  suggestedAction: 'Increase timeout or optimize operation',
});
```

**Recovery Strategy:** RetryStrategy with increased timeout

---

### TIMEOUT_COMMAND

**Description:** Command execution timeout

**Occurs When:**
- Child process took too long
- Shell command exceeded timeout
- Long-running script not completing
- Hanging process or infinite loop

**Suggested Action:**
- Profile command: `time <command>`
- Optimize slow operations
- Increase timeout if appropriate
- Add timeout to prevent hangs
- Implement watchdog timer

**Retryable:** Yes

**Severity:** MEDIUM

**Example:**
```typescript
throw new TimeoutError('Command timeout', {
  code: TimeoutErrorCode.COMMAND_TIMEOUT,
  severity: ErrorSeverity.MEDIUM,
  retryable: true,
  context: {
    command: 'npm test',
    timeout: 60000,
    elapsed: 60500,
  },
  suggestedAction: 'Optimize tests or increase timeout',
});
```

**Recovery Strategy:** RetryStrategy with longer timeout

---

### TIMEOUT_HANDSHAKE

**Description:** Protocol handshake timeout

**Occurs When:**
- SSL/TLS handshake exceeded timeout
- SSH key exchange exceeded timeout
- Initial connection negotiation too slow
- Authentication handshake stalled

**Suggested Action:**
- Increase handshake timeout
- Check SSL/TLS configuration
- Verify certificate validity
- Check network latency
- Review authentication protocol

**Retryable:** Yes

**Severity:** MEDIUM

**Example:**
```typescript
throw new TimeoutError('Handshake timeout', {
  code: TimeoutErrorCode.HANDSHAKE_TIMEOUT,
  severity: ErrorSeverity.MEDIUM,
  retryable: true,
  context: {
    protocol: 'TLS',
    timeout: 10000,
    elapsed: 10500,
  },
  suggestedAction: 'Increase handshake timeout or check server',
});
```

**Recovery Strategy:** RetryStrategy

---

### TIMEOUT_READ

**Description:** Read operation timeout

**Occurs When:**
- Reading from slow source
- Data not arriving from network
- Waiting for input from user/device
- Buffer not filling within timeout
- Remote service not sending data

**Suggested Action:**
- Increase read timeout
- Check data source is responding
- Verify network connectivity
- Reduce data chunk size
- Implement streaming for large reads

**Retryable:** Yes

**Severity:** MEDIUM

**Example:**
```typescript
throw new TimeoutError('Read timeout', {
  code: TimeoutErrorCode.READ_TIMEOUT,
  severity: ErrorSeverity.MEDIUM,
  retryable: true,
  context: {
    source: 'file',
    bytesRead: 0,
    timeout: 5000,
  },
  suggestedAction: 'Increase read timeout or check source availability',
});
```

**Recovery Strategy:** RetryStrategy

---

### TIMEOUT_WRITE

**Description:** Write operation timeout

**Occurs When:**
- Writing to slow destination
- Destination buffer full
- Network can't keep up with send rate
- Disk I/O slow
- Remote service not accepting data

**Suggested Action:**
- Increase write timeout
- Verify destination is accepting data
- Check disk/network capacity
- Implement buffering or rate limiting
- Profile write performance

**Retryable:** Yes

**Severity:** MEDIUM

**Example:**
```typescript
throw new TimeoutError('Write timeout', {
  code: TimeoutErrorCode.WRITE_TIMEOUT,
  severity: ErrorSeverity.MEDIUM,
  retryable: true,
  context: {
    destination: 'database',
    bytesWritten: 1024,
    timeout: 10000,
  },
  suggestedAction: 'Increase write timeout or optimize destination',
});
```

**Recovery Strategy:** RetryStrategy

---

## FILESYSTEM Category (8 codes)

Filesystem errors represent file operations and path issues.

### FS_NOT_FOUND

**Description:** File or directory not found

**Occurs When:**
- File path doesn't exist
- Relative path incorrect
- File deleted between check and use
- Wrong working directory
- Path case mismatch on case-sensitive filesystem

**Suggested Action:**
- Verify file path: `ls -l <path>`
- Check working directory: `pwd`
- Use absolute paths to avoid confusion
- Create file if it should exist
- Check path case sensitivity

**Retryable:** No

**Severity:** MEDIUM

**Example:**
```typescript
throw new FilesystemError('File not found', {
  code: FilesystemErrorCode.NOT_FOUND,
  severity: ErrorSeverity.MEDIUM,
  retryable: false,
  context: {
    path: '/app/config.json',
    operation: 'read',
  },
  suggestedAction: 'Verify file exists and path is correct',
});
```

**Recovery Strategy:** None - requires correct path

---

### FS_PERM_DENIED

**Description:** Permission denied accessing file

**Occurs When:**
- File permissions don't allow read/write
- User doesn't own file
- Group doesn't have permission
- Filesystem mounted read-only
- SELinux policy blocks access

**Suggested Action:**
- Check permissions: `ls -l <file>`
- Fix permissions: `chmod 644 <file>` or `chmod 755 <dir>`
- Check ownership: `chown <user>:<group> <file>`
- Verify filesystem is writable
- Check SELinux context: `ls -Z <file>`

**Retryable:** No

**Severity:** MEDIUM

**Example:**
```typescript
throw new FilesystemError('Permission denied', {
  code: FilesystemErrorCode.PERMISSION_DENIED,
  severity: ErrorSeverity.MEDIUM,
  retryable: false,
  context: {
    path: '/etc/config.conf',
    operation: 'write',
    permissions: '-r--r--r--',
  },
  suggestedAction: 'Increase file permissions or run as appropriate user',
});
```

**Recovery Strategy:** Permission fix required

---

### FS_READ_FAILED

**Description:** File read operation failed

**Occurs When:**
- I/O error reading file
- File is being modified concurrently
- Disk error or corruption
- File encoding mismatch
- Buffer allocation failed

**Suggested Action:**
- Check disk health: `dmesg | tail`
- Verify file integrity: `md5sum <file>`
- Check file encoding matches reader
- Try reading with different tools
- Run filesystem check: `fsck -n <device>`

**Retryable:** Yes

**Severity:** MEDIUM

**Example:**
```typescript
throw new FilesystemError('Read failed', {
  code: FilesystemErrorCode.READ_FAILED,
  severity: ErrorSeverity.MEDIUM,
  retryable: true,
  context: {
    path: '/data/large-file.bin',
    bytesRead: 1024,
    totalSize: 10240,
    error: 'I/O error',
  },
  suggestedAction: 'Check disk health and retry',
});
```

**Recovery Strategy:** RetryStrategy

---

### FS_WRITE_FAILED

**Description:** File write operation failed

**Occurs When:**
- Disk full
- I/O error writing
- Permission denied
- File in use/locked
- Disk failure

**Suggested Action:**
- Check disk space: `df -h <path>`
- Check disk health: `dmesg | tail`
- Verify file permissions are writable
- Check for file locks: `lsof <file>`
- Try writing to different location

**Retryable:** Yes (after cleanup)

**Severity:** MEDIUM

**Example:**
```typescript
throw new FilesystemError('Write failed', {
  code: FilesystemErrorCode.WRITE_FAILED,
  severity: ErrorSeverity.MEDIUM,
  retryable: true,
  context: {
    path: '/data/output.txt',
    reason: 'No space left on device',
  },
  suggestedAction: 'Free disk space and retry',
});
```

**Recovery Strategy:** RetryStrategy after cleanup

---

### FS_IS_DIR

**Description:** Expected file but got directory

**Occurs When:**
- Path points to directory not file
- Code assumes path is file
- Configuration error in paths
- File replaced with directory

**Suggested Action:**
- Verify expected path points to file: `test -f <path>`
- Use correct file path
- Check configuration for path
- Remove directory and create file if needed

**Retryable:** No

**Severity:** MEDIUM

**Example:**
```typescript
throw new FilesystemError('Is a directory', {
  code: FilesystemErrorCode.IS_DIRECTORY,
  severity: ErrorSeverity.MEDIUM,
  retryable: false,
  context: {
    path: '/data',
    operation: 'read',
    type: 'directory',
  },
  suggestedAction: 'Use correct file path, not directory',
});
```

**Recovery Strategy:** None - path correction required

---

### FS_NOT_DIR

**Description:** Expected directory but got file

**Occurs When:**
- Path points to file not directory
- Code assumes path is directory
- Configuration error
- File replaced with directory

**Suggested Action:**
- Verify path points to directory: `test -d <path>`
- Use correct directory path
- Create directory if it doesn't exist: `mkdir -p <path>`
- Remove file if directory is needed

**Retryable:** No

**Severity:** MEDIUM

**Example:**
```typescript
throw new FilesystemError('Not a directory', {
  code: FilesystemErrorCode.NOT_DIRECTORY,
  severity: ErrorSeverity.MEDIUM,
  retryable: false,
  context: {
    path: '/data/file.txt',
    operation: 'mkdir',
    type: 'file',
  },
  suggestedAction: 'Use directory path or create parent directories',
});
```

**Recovery Strategy:** None - path correction required

---

### FS_EXISTS

**Description:** File already exists

**Occurs When:**
- Trying to create file that exists
- Overwrite protection enabled
- File created between check and creation
- Atomic operation expected but file exists

**Suggested Action:**
- Delete existing file: `rm <path>`
- Use different filename
- Check if file should be updated instead of created
- Implement proper locking for concurrent creation

**Retryable:** No

**Severity:** LOW

**Example:**
```typescript
throw new FilesystemError('File exists', {
  code: FilesystemErrorCode.EXISTS,
  severity: ErrorSeverity.LOW,
  retryable: false,
  context: {
    path: '/data/backup.tar.gz',
    operation: 'create',
  },
  suggestedAction: 'Delete existing file or use different filename',
});
```

**Recovery Strategy:** User choice or automatic cleanup

---

### FS_INVALID_PATH

**Description:** Invalid file path

**Occurs When:**
- Path contains invalid characters
- Path is null or empty
- Path exceeds maximum length
- Path format invalid for OS
- Path contains non-existent components in strict mode

**Suggested Action:**
- Validate path: `test -e <path>`
- Check path length
- Remove invalid characters
- Use path validation library
- Verify path format matches OS

**Retryable:** No

**Severity:** MEDIUM

**Example:**
```typescript
throw new FilesystemError('Invalid path', {
  code: FilesystemErrorCode.INVALID_PATH,
  severity: ErrorSeverity.MEDIUM,
  retryable: false,
  context: {
    path: '/data/\x00/file.txt',
    reason: 'Contains null byte',
  },
  suggestedAction: 'Use valid file path without special characters',
});
```

**Recovery Strategy:** None - path validation required

---

## Error Code Summary Table

| Code | Category | Retryable | Severity | Action |
|------|----------|-----------|----------|--------|
| NET_CONN_TIMEOUT | NETWORK | Yes | HIGH | Check connectivity |
| NET_DNS_FAILURE | NETWORK | Yes | HIGH | Verify DNS |
| NET_CONN_REFUSED | NETWORK | Yes | HIGH | Check service |
| NET_UNREACHABLE | NETWORK | Yes | HIGH | Check routing |
| NET_RESET | NETWORK | Yes | HIGH | Check stability |
| NET_KEEP_ALIVE_TIMEOUT | NETWORK | Yes | HIGH | Reduce idle time |
| NET_PROTOCOL_ERROR | NETWORK | Yes | HIGH | Check protocol |
| PROC_SPAWN_FAILED | PROCESS | No | HIGH | Check executable |
| PROC_EXIT_CODE | PROCESS | No | HIGH | Check output |
| PROC_SIGNAL_RECEIVED | PROCESS | Yes | HIGH | Check timeout |
| PROC_TIMEOUT | PROCESS | Yes | HIGH | Optimize |
| PROC_NOT_FOUND | PROCESS | No | HIGH | Install tool |
| PROC_PERM_DENIED | PROCESS | No | HIGH | Fix permissions |
| PROC_INVALID_ARGS | PROCESS | No | HIGH | Fix arguments |
| SSH_AUTH_FAILED | SSH | No | HIGH | Verify credentials |
| SSH_CONN_FAILED | SSH | Yes | HIGH | Check server |
| SSH_CMD_FAILED | SSH | No | HIGH | Check command |
| SSH_TIMEOUT | SSH | Yes | HIGH | Check latency |
| SSH_HOST_KEY_VERIFY | SSH | No | HIGH | Verify identity |
| SSH_CHANNEL_OPEN_FAIL | SSH | Yes | HIGH | Reduce connections |
| SSH_DISCONNECTED | SSH | Yes | HIGH | Check network |
| RES_MEMORY_EXCEEDED | RESOURCE | Yes | CRITICAL | Increase memory |
| RES_CPU_LIMIT | RESOURCE | No | CRITICAL | Reduce load |
| RES_FH_EXCEEDED | RESOURCE | Yes | CRITICAL | Increase limit |
| RES_DISK_FULL | RESOURCE | No | CRITICAL | Free space |
| RES_NOT_AVAILABLE | RESOURCE | Yes | HIGH | Increase pool |
| RES_QUOTA_EXCEEDED | RESOURCE | Yes | HIGH | Wait/upgrade |
| SEC_VALIDATION_FAILED | SECURITY | No | HIGH | Fix input |
| SEC_POLICY_VIOLATION | SECURITY | No | HIGH | Request access |
| SEC_UNAUTHORIZED | SECURITY | No | HIGH | Authenticate |
| SEC_FORBIDDEN | SECURITY | No | HIGH | Request perms |
| SEC_INVALID_SIG | SECURITY | No | HIGH | Check integrity |
| SEC_CERT_INVALID | SECURITY | No | HIGH | Renew cert |
| TIMEOUT_OPERATION | TIMEOUT | Yes | MEDIUM | Increase timeout |
| TIMEOUT_COMMAND | TIMEOUT | Yes | MEDIUM | Optimize/extend |
| TIMEOUT_HANDSHAKE | TIMEOUT | Yes | MEDIUM | Check server |
| TIMEOUT_READ | TIMEOUT | Yes | MEDIUM | Extend timeout |
| TIMEOUT_WRITE | TIMEOUT | Yes | MEDIUM | Extend timeout |
| FS_NOT_FOUND | FILESYSTEM | No | MEDIUM | Check path |
| FS_PERM_DENIED | FILESYSTEM | No | MEDIUM | Fix perms |
| FS_READ_FAILED | FILESYSTEM | Yes | MEDIUM | Check disk |
| FS_WRITE_FAILED | FILESYSTEM | Yes | MEDIUM | Check space |
| FS_IS_DIR | FILESYSTEM | No | MEDIUM | Fix path |
| FS_NOT_DIR | FILESYSTEM | No | MEDIUM | Fix path |
| FS_EXISTS | FILESYSTEM | No | LOW | Delete/rename |
| FS_INVALID_PATH | FILESYSTEM | No | MEDIUM | Validate path |

---

**Related Documentation:**
- [Error System Overview](ERROR_SYSTEM_OVERVIEW.md)
- [Recovery Strategies Guide](RECOVERY_STRATEGIES_GUIDE.md)
- [Best Practices](BEST_PRACTICES.md)
- [Examples](EXAMPLES.md)
- [Troubleshooting](TROUBLESHOOTING.md)
