import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface PimgSettings {
    githubAccessToken: string;
    githubUsername: string;
    workerUrl: string;
    enableOnPaste: boolean;
    enableOnDrop: boolean;
    showUploadProgress: boolean;
    fallbackToLocal: boolean;
}

const DEFAULT_SETTINGS: PimgSettings = {
    githubAccessToken: "",
    githubUsername: "",
    workerUrl: "https://your-worker-name.your-subdomain.workers.dev",
    enableOnPaste: true,
    enableOnDrop: true,
    showUploadProgress: true,
    fallbackToLocal: true,
};

export default class PimgPlugin extends Plugin {
    settings: PimgSettings;
    private isUploading = false;

    async onload() {
        await this.loadSettings();
        this.register(() => document.body.removeClass('pimg-plugin-active'));
        document.body.addClass('pimg-plugin-active');
        this.registerEvent(
            this.app.workspace.on('editor-paste', (event: ClipboardEvent, editor: Editor, view: MarkdownView) => {
                if (this.settings.enableOnPaste) {
                    this.handlePaste(event, editor, view);
                }
            })
        );
        if (this.settings.enableOnDrop) {
            this.registerDragAndDrop();
        }

        this.addSettingTab(new PimgSettingsTab(this.app, this));
        // console.log('Pimg Plugin loaded');
    }

    onunload() {
        document.body.removeClass('pimg-plugin-active');
        // console.log('Pimg Plugin unloaded');
    }

    private async handlePaste(event: ClipboardEvent, editor: Editor, view: MarkdownView) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return;

        const items = clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    event.preventDefault();
                    await this.uploadImageFile(file, editor, view);
                    break;
                }
            }
        }
    }

    private registerDragAndDrop() {
        this.registerDomEvent(document, 'dragover', (event: DragEvent) => {
            event.preventDefault();
        });

        this.registerDomEvent(document, 'drop', async (event: DragEvent) => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) return;

            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file.type.startsWith('image/')) {
                    event.preventDefault();
                    await this.uploadImageFile(file, activeView.editor, activeView);
                    break;
                }
            }
        });
    }

    public async uploadImageFile(file: File, editor: Editor, view: MarkdownView) {
        if (this.isUploading) {
            new Notice('Another upload is in progress. Please wait.');
            return;
        }
        if (!this.settings.githubAccessToken || this.settings.githubAccessToken === "") {
            new Notice('GitHub Access Token is not set. Please set it in the plugin settings.');
            return;
        }
        if (!this.settings.workerUrl || this.settings.workerUrl === "") {
            new Notice('Worker URL is not set. Please set it in the plugin settings.');
            return;
        }

        this.isUploading = true;
        let notice: Notice | null = null;
        if (this.settings.showUploadProgress) {
            notice = new Notice('Uploading image...', 0);
        }

        try {
            const imageUrl = await this.uploadToGist(file);
            if (imageUrl) {
                const imageMarkdown = `![${file.name}](${imageUrl})`;
                editor.replaceSelection(imageMarkdown);
                await this.saveSettings();
                if (notice) notice.hide();
                new Notice('✅ Image uploaded successfully');
            } else {
                throw new Error('Upload failed');
            }
        } catch (error) {
            console.error('Cloud upload failed:', error);
            if (notice) notice.hide();

            if (this.settings.fallbackToLocal) {
                new Notice('Upload failed. Saving image locally...');
                await this.fallbackToLocalSave(file, editor, view);
            } else {
                new Notice(`Upload failed: ${error.message}`);
            }
        } finally {
            this.isUploading = false;
        }
    }

    private async uploadToGist(file: File): Promise<string | null> {
        const formData = new FormData();
        formData.append('image', file);
        formData.append('githubAccessToken', this.settings.githubAccessToken);
        formData.append('githubUsername', this.settings.githubUsername);

        const response = await fetch(this.settings.workerUrl, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        return result.success ? result.imageUrl : null;
    }

    private async fallbackToLocalSave(file: File, editor: Editor, view: MarkdownView) {
        try {
            const fileName = file.name;
            const sourcePath = view.file?.path ?? "";
            const vaultPath = await this.app.fileManager.getAvailablePathForAttachment(
                fileName,
                sourcePath
            );
            const data = await file.arrayBuffer();
            const created = await this.app.vault.createBinary(vaultPath, data);
            const url = this.app.vault.getResourcePath(created);
            editor.replaceSelection(`![${file.name}](${url})`);
            new Notice("Image saved locally as fallback");
        }
        catch (err) {
            console.error("Fallback save failed:", err);
            new Notice("Both Cloud upload and local fallback failed");
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class PimgSettingsTab extends PluginSettingTab {
    plugin: PimgPlugin;

    constructor(app: App, plugin: PimgPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('pimg-settings');

        const headerContainer = containerEl.createDiv({ cls: 'pimg-settings-header' });
        headerContainer.createEl('h1', {
            text: 'Pimg Settings',
            cls: 'pimg-settings-title'
        });

        containerEl.createEl('p', {
            text: 'Made by @Md_Sadiq_Md',
            cls: 'pimg-credits'
        });

        const configSection = containerEl.createDiv({ cls: 'pimg-settings-section' });
        configSection.createEl('h2', {
            text: 'Configuration',
            cls: 'pimg-section-title'
        });
        const credsGroup = configSection.createDiv({ cls: 'pimg-settings-group' });

        new Setting(credsGroup)
            .setName('GitHub Access Token')
            .setDesc('Personal access token with gist permissions from GitHub')
            .addText(text => text
                .setPlaceholder('ghp_xxxxxxxxxxxxxxxxxxxx')
                .setValue(this.plugin.settings.githubAccessToken)
                .onChange(async (value) => {
                    this.plugin.settings.githubAccessToken = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(credsGroup)
            .setName('GitHub Username')
            .setDesc('Your GitHub username')
            .addText(text => text
                .setPlaceholder('your-username')
                .setValue(this.plugin.settings.githubUsername)
                .onChange(async (value) => {
                    this.plugin.settings.githubUsername = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(credsGroup)
            .setName('Cloudflare Worker URL')
            .setDesc('URL of your deployed Cloudflare Worker')
            .addText(text => text
                .setPlaceholder('https://your-worker.your-subdomain.workers.dev')
                .setValue(this.plugin.settings.workerUrl)
                .onChange(async (value) => {
                    this.plugin.settings.workerUrl = value;
                    await this.plugin.saveSettings();
                }));

        const behaviorSection = containerEl.createDiv({ cls: 'pimg-settings-section' });
        behaviorSection.createEl('h2', {
            text: 'Behavior Settings',
            cls: 'pimg-section-title'
        });
        const toggleGroup = behaviorSection.createDiv({ cls: 'pimg-settings-group' });

        new Setting(toggleGroup)
            .setName('Enable paste upload')
            .setDesc('Automatically upload images when pasted from clipboard')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableOnPaste)
                .onChange(async (value) => {
                    this.plugin.settings.enableOnPaste = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(toggleGroup)
            .setName('Enable drag & drop upload')
            .setDesc('Automatically upload images when dragged and dropped')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableOnDrop)
                .onChange(async (value) => {
                    this.plugin.settings.enableOnDrop = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(toggleGroup)
            .setName('Show upload progress')
            .setDesc('Display notification during image upload')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showUploadProgress)
                .onChange(async (value) => {
                    this.plugin.settings.showUploadProgress = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(toggleGroup)
            .setName('Fallback to local storage')
            .setDesc('Save images locally if Cloud upload fails')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fallbackToLocal)
                .onChange(async (value) => {
                    this.plugin.settings.fallbackToLocal = value;
                    await this.plugin.saveSettings();
                }));
    }
}
