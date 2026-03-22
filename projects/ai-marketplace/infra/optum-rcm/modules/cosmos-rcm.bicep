// =============================================================================
// Optum RCM Real MVP — Cosmos DB Module
// =============================================================================
// Creates a Cosmos DB account with autoscale and the 5 MVP containers:
//   1. templates       — approved orchestration templates
//   2. executions      — live workflow instances
//   3. tasks           — human reviewer work queue items
//   4. audit-log       — immutable execution event history
//   5. case-snapshots  — normalized source payloads
// =============================================================================

@description('Cosmos DB account name')
param accountName string

@description('Azure region')
param location string

@description('Database name')
param databaseName string = 'optum-rcm'

// ─── Account ────────────────────────────────────────────────────────────────

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: accountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    // Use autoscale instead of serverless for production predictability
    disableLocalAuth: false // Switch to true + RBAC when ready
    backupPolicy: {
      type: 'Continuous'
      continuousModeProperties: { tier: 'Continuous7Days' }
    }
  }
}

// ─── Database ───────────────────────────────────────────────────────────────

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: { id: databaseName }
  }
}

// ─── Container 1: templates ─────────────────────────────────────────────────

resource templatesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'templates'
  properties: {
    resource: {
      id: 'templates'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
    }
    options: {
      autoscaleSettings: { maxThroughput: 1000 }
    }
  }
}

// ─── Container 2: executions ────────────────────────────────────────────────

resource executionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'executions'
  properties: {
    resource: {
      id: 'executions'
      partitionKey: { paths: ['/tenantId'], kind: 'Hash' }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/"_etag"/?' }]
        compositeIndexes: [
          [
            { path: '/status', order: 'ascending' }
            { path: '/updatedAt', order: 'descending' }
          ]
        ]
      }
    }
    options: {
      autoscaleSettings: { maxThroughput: 4000 }
    }
  }
}

// ─── Container 3: tasks ─────────────────────────────────────────────────────

resource tasksContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'tasks'
  properties: {
    resource: {
      id: 'tasks'
      partitionKey: { paths: ['/assignedRole'], kind: 'Hash' }
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/"_etag"/?' }]
        compositeIndexes: [
          [
            { path: '/status', order: 'ascending' }
            { path: '/dueAt', order: 'ascending' }
          ]
        ]
      }
    }
    options: {
      autoscaleSettings: { maxThroughput: 1000 }
    }
  }
}

// ─── Container 4: audit-log ─────────────────────────────────────────────────

resource auditLogContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'audit-log'
  properties: {
    resource: {
      id: 'audit-log'
      partitionKey: { paths: ['/executionId'], kind: 'Hash' }
      defaultTtl: 15552000 // 180 days for compliance retention
      indexingPolicy: {
        indexingMode: 'consistent'
        includedPaths: [{ path: '/*' }]
        excludedPaths: [{ path: '/"_etag"/?' }]
      }
    }
    options: {
      autoscaleSettings: { maxThroughput: 2000 }
    }
  }
}

// ─── Container 5: case-snapshots ────────────────────────────────────────────

resource caseSnapshotsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: 'case-snapshots'
  properties: {
    resource: {
      id: 'case-snapshots'
      partitionKey: { paths: ['/caseId'], kind: 'Hash' }
      defaultTtl: 7776000 // 90 days
    }
    options: {
      autoscaleSettings: { maxThroughput: 1000 }
    }
  }
}

// ─── Outputs ────────────────────────────────────────────────────────────────

output endpoint string = cosmosAccount.properties.documentEndpoint
output accountName string = cosmosAccount.name
output primaryKey string = cosmosAccount.listKeys().primaryMasterKey
