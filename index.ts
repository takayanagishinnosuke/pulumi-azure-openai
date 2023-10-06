import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";
import { getConnectionString, signedBlobReadUrl } from "./helpers";
import * as dotenv from "dotenv";

dotenv.config();

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

const logAnalyticsWorkspace = new azure.operationalinsights.Workspace("logAnalyticsWorkspace", {
    resourceGroupName: resourceGroup.name,
});

const appInsights = new azure.insights.Component("appInsights", {
    applicationType: "web",
    kind: "web",
    resourceGroupName: resourceGroup.name,
    workspaceResourceId: logAnalyticsWorkspace.id,
});


// Create a blob storage account.
const storageAccount = new azure.storage.StorageAccount("account", {
    resourceGroupName: resourceGroup.name,
    kind: azure.storage.Kind.StorageV2,
    sku: {
        name: azure.storage.SkuName.Standard_LRS,
    },
});


// Create a storage container for the serverless app.
const appContainer = new azure.storage.BlobContainer("app-container", {
    accountName: storageAccount.name,
    resourceGroupName: resourceGroup.name,
    publicAccess: azure.storage.PublicAccess.None,
});

// Upload the Function app to the storage container.
const appBlob = new azure.storage.Blob("app-blob", {
    accountName: storageAccount.name,
    resourceGroupName: resourceGroup.name,
    containerName: appContainer.name,
    source: new pulumi.asset.FileArchive(appPath),
});


const storageConnectionString = getConnectionString(resourceGroup.name, storageAccount.name);
const codeBlobUrl = signedBlobReadUrl(appBlob, appContainer, storageAccount, resourceGroup);

// Create an App Service plan for the Function App.
const plan = new azure.web.AppServicePlan("plan", {
    resourceGroupName: resourceGroup.name,
    sku: {
        name: "Y1",
        tier: "Dynamic",
    },
    kind: "Linux",
    reserved: true,
});

// Create the Function App.
const functionApp = new azure.web.WebApp("function-app", {
    resourceGroupName: resourceGroup.name,
    serverFarmId: plan.id,
    kind: "FunctionApp",
    siteConfig: {
        linuxFxVersion: "Node|18",
        appSettings: [
            {
                name: "AzureWebJobsStorage",
                value: storageConnectionString,

            },
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
                name: "WEBSITE_CONTENTAZUREFILECONNECTIONSTRING",
                value: storageConnectionString,
            },
            {
                name: "WEBSITE_RUN_FROM_PACKAGE",
                value: codeBlobUrl,
            },
            {
                name: "APPINSIGHTS_INSTRUMENTATIONKEY",
                value: appInsights.instrumentationKey, 

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
                value: process.env["LINE_CHANNEL_ACCESS_TOKEN"] || "",
            },
            {
                name: "LINE_CHANNEL_SECRET",
                value: process.env["LINE_CHANNEL_SECRET"] || "",
            },
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
