import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface GitHubUploaderSettings {
    workerUrl: string;
    enableOnPaste: boolean;
    enableOnDrop: boolean;
    showUploadProgress: boolean;
    fallbackToLocal: boolean;
}

const DEFAULT_SETTINGS: GitHubUploaderSettings = {
    workerUrl: process.env.WORKER_URL as string,
    enableOnPaste: true,
    enableOnDrop: true,
    showUploadProgress: true,
    fallbackToLocal: true
};

export default class GitHubUploaderPlugin extends Plugin {
    settings: GitHubUploaderSettings;
    private isUploading = false;

    async onload() {
        await this.loadSettings();
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

        this.addCommand({
            id: 'upload-image-github',
            name: 'Upload image to GitHub',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.showImageUploadModal(editor, view);
            }
        });

        const ribbonIconEl = this.addRibbonIcon('image', 'GitHub Image Uploader', (evt: MouseEvent) => {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                this.showImageUploadModal(activeView.editor, activeView);
            } else {
                new Notice('Please open a markdown file to upload images');
            }
        });
        ribbonIconEl.addClass('github-uploader-ribbon-class');
        this.addSettingTab(new GitHubUploaderSettingsTab(this.app, this));

        console.log('GitHub Uploader Plugin loaded');
    }

    onunload() {
        console.log('GitHub Uploader Plugin unloaded');
    }

    private async handlePaste(event: ClipboardEvent, editor: Editor, view: MarkdownView) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return;

        const items = clipboardData.items;
        let hasImage = false;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                hasImage = true;
                const file = item.getAsFile();
                if (file) {
                    event.preventDefault();
                    await this.uploadImageFile(file, editor, view);
                }
                break;
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
                }
            }
        });
    }

    public async uploadImageFile(file: File, editor: Editor, view: MarkdownView) {
        if (this.isUploading) {
            new Notice('Another upload is in progress. Please wait.');
            return;
        }

        this.isUploading = true;

        let notice: Notice | null = null;
        if (this.settings.showUploadProgress) {
            notice = new Notice('Uploading image to GitHub...', 0);
        }

        try {
            const imageUrl = await this.uploadToGitHub(file);

            if (imageUrl) {
                const imageMarkdown = `![${file.name}](${imageUrl})`;
                editor.replaceSelection(imageMarkdown);

                if (notice) {
                    notice.hide();
                    new Notice('Image uploaded successfully!');
                }
            } else {
                throw new Error('Upload failed');
            }
        } catch (error) {
            console.error('GitHub upload failed:', error);

            if (notice) {
                notice.hide();
            }

            if (this.settings.fallbackToLocal) {
                new Notice('GitHub upload failed. Saving image locally...');
                await this.fallbackToLocalSave(file, editor, view);
            } else {
                new Notice(`GitHub upload failed: ${error.message}`);
            }
        } finally {
            this.isUploading = false;
        }
    }

    private async uploadToGitHub(file: File): Promise<string | null> {
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch(this.settings.workerUrl, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json();

        if (result.success) {
            return result.imageUrl;
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    }

    private async fallbackToLocalSave(file: File, editor: Editor, view: MarkdownView) {
        try {
            const timestamp = Date.now();
            const fileExtension = file.name.split('.').pop() || 'png';
            const fileName = `github-fallback-${timestamp}.${fileExtension}`;
            const adapter = this.app.vault.adapter;
            const attachmentFolder = adapter.getResourcePath
                ? adapter.getResourcePath('')
                : '';
            const filePath = attachmentFolder ? `${attachmentFolder}/${fileName}` : fileName;
            const arrayBuffer = await file.arrayBuffer();
            const createdFile = await this.app.vault.createBinary(filePath, arrayBuffer);
            const imageMarkdown = `![${file.name}](${this.app.vault.adapter.getResourcePath(createdFile.path)})`;
            editor.replaceSelection(imageMarkdown);

            new Notice('Image saved locally as fallback');
        } catch (error) {
            console.error('Fallback save failed:', error);
            new Notice('Both GitHub upload and local fallback failed');
        }
    }

    private showImageUploadModal(editor: Editor, view: MarkdownView) {
        new ImageUploadModal(this.app, this, editor, view).open();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class ImageUploadModal extends Modal {
    plugin: GitHubUploaderPlugin;
    editor: Editor;
    view: MarkdownView;

    constructor(app: App, plugin: GitHubUploaderPlugin, editor: Editor, view: MarkdownView) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        this.view = view;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Upload Image to GitHub' });

        const inputEl = contentEl.createEl('input', {
            type: 'file',
            attr: {
                accept: 'image/*',
                multiple: 'true'
            }
        });

        const uploadBtn = contentEl.createEl('button', {
            text: 'Upload',
            cls: 'mod-cta'
        });

        uploadBtn.onclick = async () => {
            const files = inputEl.files;
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    await this.plugin.uploadImageFile(files[i], this.editor, this.view);
                }
                this.close();
            }
        };

        contentEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            contentEl.addClass('drag-over');
        });

        contentEl.addEventListener('dragleave', (e) => {
            e.preventDefault();
            contentEl.removeClass('drag-over');
        });

        contentEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            contentEl.removeClass('drag-over');

            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (file.type.startsWith('image/')) {
                        await this.plugin.uploadImageFile(file, this.editor, this.view);
                    }
                }
                this.close();
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class GitHubUploaderSettingsTab extends PluginSettingTab {
    plugin: GitHubUploaderPlugin;

    constructor(app: App, plugin: GitHubUploaderPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'GitHub Uploader Settings Made by @Md_Sadiq_Md' });

        new Setting(containerEl)
            .setName('Enable paste upload')
            .setDesc('Automatically upload images when pasted from clipboard')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableOnPaste)
                .onChange(async (value) => {
                    this.plugin.settings.enableOnPaste = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable drag & drop upload')
            .setDesc('Automatically upload images when dragged and dropped')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableOnDrop)
                .onChange(async (value) => {
                    this.plugin.settings.enableOnDrop = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show upload progress')
            .setDesc('Display notification during image upload')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showUploadProgress)
                .onChange(async (value) => {
                    this.plugin.settings.showUploadProgress = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Fallback to local storage')
            .setDesc('Save images locally if GitHub upload fails')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.fallbackToLocal)
                .onChange(async (value) => {
                    this.plugin.settings.fallbackToLocal = value;
                    await this.plugin.saveSettings();
                }));
    }
}
