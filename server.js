const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
const PORT = 3000;
let PROJECT_ROOT_API = path.normalize('F:/[Phone] Photos Videos/Namiseon Vid');
const PROJECT_ROOT_UI = __dirname;

app.get('/', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT_UI, 'index.html'));
});

app.get('/api/drives', (req, res) => {
    const drives = [];
    for (let letter = 65; letter <= 90; letter++) {
        const drive = String.fromCharCode(letter) + ':\\';
        try {
            fs.statSync(drive);
            drives.push(drive);
        } catch {}
    }
    res.json({ drives });
});

app.get('/api/files', (req, res) => {
    const queryPath = req.query.path || '.';
    const fullPath = path.resolve(PROJECT_ROOT_API, queryPath);

    // Security: restrict to project root and subdirectories
    if (!fullPath.startsWith(PROJECT_ROOT_API)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        let items = [];
        for (const name of fs.readdirSync(fullPath)) {
            const fullItemPath = path.join(fullPath, name);
            try {
                const stat = fs.lstatSync(fullItemPath);
                if (!stat.isSymbolicLink()) {
                    items.push({
                        name: name,
                        isDirectory: stat.isDirectory(),
                        size: stat.size,
                        modified: stat.mtime
                    });
                }
            } catch (err) {
                // Skip files that can't be accessed, e.g., locked
            }
        }
        res.json({ path: path.relative(PROJECT_ROOT_API, fullPath) || '.', fullPath: fullPath, items });
    } catch (err) {
        console.log('Error readdir on', fullPath, err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/set-root', (req, res) => {
    const { path: rootPath } = req.body;
    if (rootPath) {
        PROJECT_ROOT_API = path.normalize(rootPath);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Path is required' });
    }
});

app.get('/api/get-root', (req, res) => {
    res.json({ root: PROJECT_ROOT_API });
});

app.get('/api/file', (req, res) => {
    const queryPath = req.query.path;
    const fullPath = path.resolve(PROJECT_ROOT_API, queryPath);

    // Security: restrict to project root and subdirectories
    if (!fullPath.startsWith(PROJECT_ROOT_API)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            res.sendFile(fullPath);
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`File explorer server running at http://localhost:${PORT}`);
});
