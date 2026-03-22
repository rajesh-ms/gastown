// =============================================================================
// Optum RCM Real MVP — Root Bicep Template
// =============================================================================
// Deploys the minimum Azure infrastructure for the four production RCM
// workflow templates: Eligibility, Prior Auth, Claims, Payment Posting.
//
// Services:
//   1. Cosmos DB (NoSQL, autoscale) — 5 containers
//   2. Azure Functions (Flex Consumption) — orchestration API + connectors
//   3. Azure Service Bus — async resume events + work queues
//   4. Azure Key Vault — secrets + certificates
//   5. Application Insights + Log Analytics — telemetry
//   6. Azure Container Apps — internal operations console
//   7. Azure Container Registry — web image store
//
// Deploy with:
//   azd up
//   -- or --
//   az deployment group create \
//     --resource-group rg-optum-rcm-real-prod \
//     --template-file main.bicep
// =============================================================================

targetScope = 'resourceGroup'

@description('Name prefix for all resources')
param appName string = 'optum-rcm'

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Deployment environment')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'prod'

@description('Entra ID tenant ID')
param tenantId string = subscription().tenantId

@description('Entra app registration client ID for the operations console')
param entraClientId string = ''

@description('Container image tag for the web console')
param imageTag string = 'latest'

// ─── Naming ──────────────────────────────────────────────────────────────────

var suffix = uniqueString(resourceGroup().id)
var shortSuffix = substring(suffix, 0, 8)

var cosmosAccountName   = '${appName}-cosmos-${shortSuffix}'
var functionAppName     = '${appName}-api-${environment}'
var storageAccountName  = 'optrcmstore${shortSuffix}'
var serviceBusName      = '${appName}-sb-${shortSuffix}'
var keyVaultName        = 'optrcm-kv-${shortSuffix}'
var appInsightsName     = '${appName}-insights-${environment}'
var acrName             = 'optrcmacr${shortSuffix}'
var containerEnvName    = '${appName}-env-${environment}'
var containerAppName    = '${appName}-web-${environment}'

// ─── Application Insights ────────────────────────────────────────────────────

module appInsights '../modules/appinsights.bicep' = {
  name: 'appInsights'
  params: {
    name: appInsightsName
    location: location
  }
}

// ─── Key Vault ───────────────────────────────────────────────────────────────

module keyVault '../modules/keyvault.bicep' = {
  name: 'keyVault'
  params: {
    name: keyVaultName
    location: location
    tenantId: tenantId
  }
}

// ─── Container Registry ─────────────────────────────────────────────────────

module acr '../modules/containerregistry.bicep' = {
  name: 'containerRegistry'
  params: {
    name: acrName
    location: location
  }
}

// ─── Cosmos DB (5 MVP containers) ────────────────────────────────────────────

module cosmos 'modules/cosmos-rcm.bicep' = {
  name: 'cosmosRcm'
  params: {
    accountName: cosmosAccountName
    location: location
    databaseName: 'optum-rcm'
  }
}

// Store Cosmos key in Key Vault for Function App access
resource cosmosKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: '${keyVaultName}/cosmos-primary-key'
  properties: {
    value: cosmos.outputs.primaryKey
  }
  dependsOn: [keyVault]
}

// ─── Azure Service Bus ──────────────────────────────────────────────────────

module serviceBus 'modules/servicebus.bicep' = {
  name: 'serviceBus'
  params: {
    namespaceName: serviceBusName
    location: location
  }
}

// ─── Azure Functions API ────────────────────────────────────────────────────

module functions '../modules/functions.bicep' = {
  name: 'functions'
  params: {
    appName: functionAppName
    location: location
    storageAccountName: storageAccountName
    appInsightsInstrumentationKey: appInsights.outputs.instrumentationKey
    cosmosEndpoint: cosmos.outputs.endpoint
    cosmosKey: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=cosmos-primary-key)'
    keyVaultName: keyVaultName
  }
  dependsOn: [cosmosKeySecret]
}

// ─── Container App (operations console) ──────────────────────────────────────

module containerApp '../modules/containerapp.bicep' = {
  name: 'containerApp'
  params: {
    environmentName: containerEnvName
    appName: containerAppName
    location: location
    containerImage: 'mcr.microsoft.com/k8se/quickstart:latest'
    acrLoginServer: acr.outputs.loginServer
    acrName: acr.outputs.name
    appInsightsConnectionString: appInsights.outputs.connectionString
    apiBaseUrl: functions.outputs.defaultHostName
    azureAdClientId: entraClientId
    azureAdTenantId: tenantId
  }
}

// ─── Outputs ────────────────────────────────────────────────────────────────

output cosmosEndpoint string = cosmos.outputs.endpoint
output cosmosAccountName string = cosmos.outputs.accountName
output functionsUrl string = functions.outputs.defaultHostName
output webAppUrl string = containerApp.outputs.appUrl
output serviceBusNamespace string = serviceBus.outputs.namespaceName
output keyVaultName string = keyVaultName
output appInsightsKey string = appInsights.outputs.instrumentationKey
output acrLoginServer string = acr.outputs.loginServer
