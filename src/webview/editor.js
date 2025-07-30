(function() {
    const vscode = acquireVsCodeApi();
    
    let editor = null;
    let filename = '';
    let isDirty = false;
    let originalContent = '';

    function initializeEditor() {
        editor = document.getElementById('editor');
        const saveBtn = document.getElementById('saveBtn');
        const filenameEl = document.getElementById('filename');
        const lastModifiedEl = document.getElementById('lastModified');

        // Handle content changes
        editor.addEventListener('input', function() {
            const hasChanges = editor.value !== originalContent;
            setDirty(hasChanges);
        });

        // Handle save button
        saveBtn.addEventListener('click', function() {
            if (isDirty) {
                vscode.postMessage({
                    type: 'save',
                    content: editor.value
                });
                setDirty(false);
                originalContent = editor.value;
            }
        });

        // Handle keyboard shortcuts
        editor.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (isDirty) {
                    saveBtn.click();
                }
            }
        });

        // Auto-resize textarea
        function autoResize() {
            editor.style.height = 'auto';
            editor.style.height = Math.max(editor.scrollHeight, 400) + 'px';
        }
        
        editor.addEventListener('input', autoResize);
        window.addEventListener('resize', autoResize);

        // Tell extension we're ready
        console.log('Editor initialized, sending ready message');
        vscode.postMessage({ type: 'ready' });
    }

    function setDirty(dirty) {
        isDirty = dirty;
        const saveBtn = document.getElementById('saveBtn');
        const filenameEl = document.getElementById('filename');
        
        saveBtn.disabled = !dirty;
        saveBtn.textContent = dirty ? 'Save Changes' : 'Saved';
        
        if (dirty && filename) {
            filenameEl.textContent = filename + ' •';
        } else if (filename) {
            filenameEl.textContent = filename;
        }
    }

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message from extension:', message);
        
        switch (message.type) {
            case 'fileContent':
                filename = message.filename;
                originalContent = message.content;
                
                document.getElementById('filename').textContent = filename;
                document.getElementById('editor').value = message.content;
                
                if (message.lastModified) {
                    const date = new Date(message.lastModified);
                    document.getElementById('lastModified').textContent = 
                        'Last modified: ' + date.toLocaleString();
                }
                
                setDirty(false);
                
                // Set language-specific syntax (basic)
                if (message.language) {
                    document.getElementById('editor').setAttribute('data-language', message.language);
                }
                
                // Auto-resize after content load
                setTimeout(() => {
                    const editor = document.getElementById('editor');
                    editor.style.height = 'auto';
                    editor.style.height = Math.max(editor.scrollHeight, 400) + 'px';
                }, 100);
                break;
        }
    });

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeEditor);
    } else {
        initializeEditor();
    }
})();