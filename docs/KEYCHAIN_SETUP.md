# How to Set Up Ghost API Key with Obsidian Keychain

This plugin uses Obsidian's **Secrets (Keychain)** feature to store your Ghost Admin API Key securely.

## Setup Steps

### 1. Get Your Ghost Admin API Key

1. Log in to your Ghost Admin panel
2. Go to **Settings** → **Integrations**
3. Click **Add custom integration** (or select existing one)
4. Copy your **Admin API Key** (format: `id:secret`)
   - Example: `6579a8f5c8d9e10001234567:7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a`

### 2. Create Secret in Obsidian Keychain

1. Open Obsidian **Settings** (⚙️)
2. Navigate to **Keychain** in the left sidebar
3. Click the **+ (plus)** button to add a new secret
4. Configure the secret:
   - **Name**: `ghost-api-key` (or any name you prefer)
   - **Value**: Paste your Ghost Admin API Key (the `id:secret` you copied)
5. Click **Save**

### 3. Configure Ghost Writer Manager Plugin

1. In Obsidian Settings, go to **Community Plugins** → **Ghost Writer Manager**
2. Configure:
   - **Ghost URL**: Your Ghost site URL (e.g., `https://yourblog.ghost.io`)
   - **Admin API key secret name**: Enter the name you used in step 2 (e.g., `ghost-api-key`)
   - Click the 🔑 button next to this field to quickly open Keychain settings
3. Configure other settings:
   - **Sync folder**: Where to store Ghost posts (default: `Ghost Posts`)
   - **Sync interval**: How often to sync (default: 15 minutes)
   - **YAML prefix**: Prefix for Ghost properties (default: `g_`)
4. Click **Test connection** to verify everything is working

## Why Use Keychain?

### Security Benefits

- ✅ **No plain text storage**: API key is not stored in `data.json`
- ✅ **Centralized management**: One place to manage all your secrets
- ✅ **Easy updates**: Update the secret once, all plugins see the change
- ✅ **No accidental commits**: Secrets are stored separately from your vault

### How It Works

```
┌─────────────────┐
│  Obsidian       │
│  Keychain       │
│  ┌───────────┐  │
│  │ ghost-api │  │  ← Your API key stored here
│  │ -key      │  │
│  └───────────┘  │
└────────┬────────┘
         │
         │ Plugin reads secret by name
         │
         ▼
┌─────────────────┐
│ Ghost Writer    │
│ Manager Plugin  │
└─────────────────┘
```

## Troubleshooting

### "Please configure Ghost URL and Admin API Key first"

**Cause**: The secret name is incorrect or the secret doesn't exist.

**Solution**:
1. Go to **Settings** → **Keychain**
2. Verify the secret name matches what you entered in plugin settings
3. Check that the secret value contains your Ghost API key

### "Connection failed"

**Cause**: API key format is incorrect or Ghost URL is wrong.

**Solution**:
1. Verify your Ghost URL is correct (no trailing slash)
2. Check that your API key has the format `id:secret` (with colon `:`)
3. Ensure the API key is active in Ghost Admin
4. Run **Debug: Test JWT token generation** command to see detailed errors

### Secret Not Found

**Cause**: The plugin can't find a secret with the specified name.

**Solution**:
1. Double-check the secret name spelling
2. Ensure the secret was saved (click 🔑 button to open Keychain)
3. Try creating the secret again

## Changing Your API Key

If you need to update your API key:

1. Go to **Settings** → **Keychain**
2. Find your secret (e.g., `ghost-api-key`)
3. Click the **✏️ (edit)** button
4. Update the value with your new API key
5. Save

The plugin will automatically use the new key on the next operation - **no need to restart Obsidian**.

## Multiple Ghost Sites

If you manage multiple Ghost sites, you can create multiple secrets:

1. Create separate secrets:
   - `ghost-api-key-blog1`
   - `ghost-api-key-blog2`

2. Use different plugin profiles (or manually change the secret name in settings)

## Security Notes

- Secrets are stored in Obsidian's secure storage
- Secrets are **not synced** across devices by default
- Each device needs its own secret configuration
- Secrets are encrypted at rest (depending on your OS keychain)

---

**Need help?** Open an issue at: https://github.com/firstpair/omnighost/issues
