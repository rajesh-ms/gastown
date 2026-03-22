// =============================================================================
// Optum RCM Real MVP — Azure Service Bus Module
// =============================================================================
// Creates a Service Bus namespace with the queues needed for workflow
// resume events, connector jobs, approval signals, and dead-letter monitoring.
// =============================================================================

@description('Service Bus namespace name')
param namespaceName string

@description('Azure region')
param location string

// ─── Namespace ───────────────────────────────────────────────────────────────

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: namespaceName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    minimumTlsVersion: '1.2'
    disableLocalAuth: false // Switch to true + managed identity when ready
  }
}

// ─── Queue: workflow-resume ──────────────────────────────────────────────────
// Receives events that resume paused workflow executions (payer callbacks,
// manual approvals, batch file arrivals).

resource resumeQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'workflow-resume'
  properties: {
    lockDuration: 'PT1M'
    maxSizeInMegabytes: 1024
    maxDeliveryCount: 5
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P7D'
  }
}

// ─── Queue: connector-jobs ──────────────────────────────────────────────────
// Outbound connector work: payer portal calls, clearinghouse submissions,
// ERA file ingestion jobs.

resource connectorQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'connector-jobs'
  properties: {
    lockDuration: 'PT2M'
    maxSizeInMegabytes: 1024
    maxDeliveryCount: 3
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P3D'
  }
}

// ─── Queue: approval-events ─────────────────────────────────────────────────
// Human approval or rejection signals from the operations console.

resource approvalQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'approval-events'
  properties: {
    lockDuration: 'PT30S'
    maxSizeInMegabytes: 1024
    maxDeliveryCount: 5
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P14D'
  }
}

// ─── Queue: dead-letter-monitor ─────────────────────────────────────────────
// Explicitly named queue for dead-letter alerting integration. Monitor this
// queue depth via Azure Monitor alerts.

resource dlqMonitorQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: 'dead-letter-monitor'
  properties: {
    lockDuration: 'PT1M'
    maxSizeInMegabytes: 1024
    maxDeliveryCount: 1
    defaultMessageTimeToLive: 'P30D'
  }
}

// ─── Outputs ────────────────────────────────────────────────────────────────

output namespaceName string = serviceBusNamespace.name
output namespaceEndpoint string = serviceBusNamespace.properties.serviceBusEndpoint
