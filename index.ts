import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";
import * as synced from "@pulumi/synced-folder";

// Import the program's configuration settings.
const config = new pulumi.Config();
const appPath = config.get("appPath") || "./app";

// Create a resource group
const resourceGroup = new azure.resources.ResourceGroup("resource-group", {});

// Create a Cognitive Services
const cognitiveservices = new azure.cognitiveservices.Account("cognitiveservices", {
    resourceGroupName: resourceGroup.name,
    kind: "OpenAI",
    sku: {
        name: "S0",
    },
    location: resourceGroup.location,
    properties:{
        publicNetworkAccess: "Enabled",
    }
});
// Create a OpenAI Model
const deployment = new azure.cognitiveservices.Deployment("deployment", {
    accountName: cognitiveservices.name,
    deploymentName: "gpt-35-turbo",
    properties: {
        model: {
            format: "OpenAI",
            name: "gpt-35-turbo",
            version: "0613",
        },
    },
    resourceGroupName: resourceGroup.name,
});

// Get the keys for the Cognitive Services account.
const openaiKeys =  azure.cognitiveservices.listAccountKeysOutput({
    accountName: cognitiveservices.name,
    resourceGroupName: resourceGroup.name,
});
const openaiKey = openaiKeys.apply(openaiKeys => openaiKeys.key1 || "");

// Create a blob storage account.
const account = new azure.storage.StorageAccount("account", {
    resourceGroupName: resourceGroup.name,
    kind: azure.storage.Kind.StorageV2,
    sku: {
        name: azure.storage.SkuName.Standard_LRS,
    },
});


// Create a storage container for the serverless app.
const appContainer = new azure.storage.BlobContainer("app-container", {
    accountName: account.name,
    resourceGroupName: resourceGroup.name,
    publicAccess: azure.storage.PublicAccess.None,
});

// Upload the serverless app to the storage container.
const appBlob = new azure.storage.Blob("app-blob", {
    accountName: account.name,
    resourceGroupName: resourceGroup.name,
    containerName: appContainer.name,
    source: new pulumi.asset.FileArchive(appPath),
});

// Create a shared access signature to give the Function App access to the code.
const signature = azure.storage.listStorageAccountServiceSASOutput({
    resourceGroupName: resourceGroup.name,
    accountName: account.name,
    protocols: azure.storage.HttpProtocol.Https,
    sharedAccessStartTime: "2022-01-01",
    sharedAccessExpiryTime: "2030-01-01",
    resource: azure.storage.SignedResource.C,
    permissions: azure.storage.Permissions.R,
    contentType: "application/json",
    cacheControl: "max-age=5",
    contentDisposition: "inline",
    contentEncoding: "deflate",
    canonicalizedResource: pulumi.interpolate`/blob/${account.name}/${appContainer.name}`,
});

// Create an App Service plan for the Function App.
const plan = new azure.web.AppServicePlan("plan", {
    resourceGroupName: resourceGroup.name,
    kind: "Linux",
    sku: {
        name: "Y1",
        tier: "Dynamic",
    },
});

// Create the Function App.
const functionApp = new azure.web.WebApp("function-app", {
    resourceGroupName: resourceGroup.name,
    serverFarmId: plan.id,
    kind: "FunctionApp",
    siteConfig: {
        appSettings: [
            {
                name: "FUNCTIONS_WORKER_RUNTIME",
                value: "node",
            },
            {
                name: "WEBSITE_NODE_DEFAULT_VERSION",
                value: "~18",
            },
            {
                name: "FUNCTIONS_EXTENSION_VERSION",
                value: "~4",
            },
            {
                name: "WEBSITE_RUN_FROM_PACKAGE",
                value: pulumi.all([account.name, appContainer.name, appBlob.name, signature])
                    .apply(([accountName, containerName, blobName, signature]) => `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${signature.serviceSasToken}`),
            },
            {
                name: "OPENAI_API_KEY",
                value: openaiKey
            },
            {
                name: "OPENAI_ENDPOINT",
                value: cognitiveservices.properties.endpoint,
            },
            {
                name: "OPENAI_DEPLOYMENT_NAME",
                value: deployment.name,
            },
            {
                name: "LINE_CHANNEL_ACCESS_TOKEN",
                value: "hoge",
            },
            {
                name: "LINE_CHANNEL_SECRET",
                value: "huga",
            },
            {
                name: "LINE_CHANNEL_ID",
                value: "0000",
            }
        ],
        cors: {
            allowedOrigins: [
                "*"
            ],
        },
    },
});


// Export the serverless endpoint.
export const apiURL = pulumi.interpolate`https://${functionApp.defaultHostName}/api`;
