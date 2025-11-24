const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1gb' }));
app.use(express.urlencoded({ extended: true, limit: '1gb', parameterLimit: 100000 }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

const PORT = 3000;
let PROJECT_ROOT_API = path.normalize('C:/');
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

// Helper function to parse multipart form data without external dependencies
function parseMultipartData(body, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from('--' + boundary);
    const endBoundaryBuffer = Buffer.from('--' + boundary + '--');
    
    let currentIndex = 0;
    
    while (currentIndex < body.length) {
        // Find boundary
        const boundaryIndex = body.indexOf(boundaryBuffer, currentIndex);
        if (boundaryIndex === -1) break;
        
        // Check if it's the end boundary
        const endBoundaryIndex = body.indexOf(endBoundaryBuffer, currentIndex);
        if (endBoundaryIndex === boundaryIndex) break;
        
        // Find end of headers (double CRLF)
        const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), boundaryIndex + boundaryBuffer.length);
        if (headerEnd === -1) break;
        
        // Extract headers
        const headerSection = body.slice(boundaryIndex + boundaryBuffer.length, headerEnd);
        const headersText = headerSection.toString('utf8');
        
        // Parse headers
        const headers = {};
        const headerLines = headersText.split('\r\n');
        for (const headerLine of headerLines) {
            const colonIndex = headerLine.indexOf(':');
            if (colonIndex > 0) {
                const name = headerLine.substring(0, colonIndex).trim().toLowerCase();
                const value = headerLine.substring(colonIndex + 1).trim();
                headers[name] = value;
            }
        }
        
        // Find next boundary to determine content end
        const nextBoundaryIndex = body.indexOf(boundaryBuffer, headerEnd + 4);
        if (nextBoundaryIndex === -1) break;
        
        // Extract content (excluding the CRLF before the next boundary)
        const contentStart = headerEnd + 4;
        const contentEnd = nextBoundaryIndex - 2; // Exclude \r\n before boundary
        const content = body.slice(contentStart, contentEnd);
        
        // Parse content-disposition
        if (headers['content-disposition']) {
            const disposition = headers['content-disposition'];
            const nameMatch = disposition.match(/name="([^"]*)"/);
            const filenameMatch = disposition.match(/filename="([^"]*)"/);
            
            if (nameMatch) {
                parts.push({
                    name: nameMatch[1],
                    filename: filenameMatch ? filenameMatch[1] : null,
                    contentType: headers['content-type'] || 'application/octet-stream',
                    data: content
                });
            }
        }
        
        currentIndex = nextBoundaryIndex;
    }
    
    return parts;
}

// Add multer-like middleware for handling multipart/form-data without external dependencies
app.post('/api/upload', (req, res) => {
    try {
        const contentType = req.get('content-type') || '';
        
        if (contentType.includes('multipart/form-data')) {
            // Handle multipart form data upload
            const chunks = [];
            
            req.on('data', (chunk) => {
                chunks.push(chunk);
            });
            
            req.on('end', () => {
                try {
                    const boundaryMatch = contentType.match(/boundary=([^;]+)/);
                    if (!boundaryMatch) {
                        return res.status(400).json({ error: 'No boundary found in multipart content' });
                    }
                    
                    const boundary = boundaryMatch[1];
                    const rawData = Buffer.concat(chunks);
                    const parts = parseMultipartData(rawData, boundary);
                    
                    let uploadPath = req.body.path || req.query.path || '.';
                    let targetDir = path.resolve(PROJECT_ROOT_API, uploadPath);
                    
                    const uploadedFiles = [];
                    
                    for (const part of parts) {
                        if (part.filename) {
                            const filePath = path.join(targetDir, part.filename);
                            fs.writeFileSync(filePath, part.data);
                            uploadedFiles.push({
                                filename: part.filename,
                                path: path.relative(PROJECT_ROOT_API, filePath),
                                size: part.data.length
                            });
                        } else if (part.name === 'path') {
                            // Handle path field from FormData
                            uploadPath = part.data.toString().trim();
                            targetDir = path.resolve(PROJECT_ROOT_API, uploadPath);
                        }
                    }
                    
                    // Security: restrict to project root and subdirectories
                    if (!targetDir.startsWith(PROJECT_ROOT_API)) {
                        return res.status(403).json({ error: 'Access denied' });
                    }
                    
                    // Create directory if it doesn't exist
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }
                    
                    res.json({ 
                        success: true, 
                        message: `${uploadedFiles.length} file(s) uploaded successfully`,
                        files: uploadedFiles 
                    });
                    
                } catch (err) {
                    console.error('Upload parsing error:', err);
                    res.status(500).json({ error: err.message });
                }
            });
            
        } else if (contentType.includes('application/json')) {
            // Handle JSON upload with base64 encoded file
            const uploadPath = req.body.path || req.query.path || '.';
            const targetDir = path.resolve(PROJECT_ROOT_API, uploadPath);
            
            // Security: restrict to project root and subdirectories
            if (!targetDir.startsWith(PROJECT_ROOT_API)) {
                return res.status(403).json({ error: 'Access denied' });
            }
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            const { filename, data, encoding } = req.body;
            
            if (!filename || !data) {
                return res.status(400).json({ error: 'Filename and data are required' });
            }
            
            let fileData;
            if (encoding === 'base64') {
                fileData = Buffer.from(data, 'base64');
            } else {
                fileData = Buffer.from(data);
            }
            
            const filePath = path.join(targetDir, filename);
            fs.writeFileSync(filePath, fileData);
            
            res.json({ 
                success: true, 
                message: 'File uploaded successfully',
                file: {
                    filename: filename,
                    path: path.relative(PROJECT_ROOT_API, filePath),
                    size: fileData.length
                }
            });
            
        } else {
            return res.status(400).json({ error: 'Unsupported content type. Use multipart/form-data or application/json' });
        }
        
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Rename file or directory
app.post('/api/rename', (req, res) => {
    try {
        const { oldPath, newPath } = req.body;
        
        if (!oldPath || !newPath) {
            return res.status(400).json({ error: 'Old path and new path are required' });
        }
        
        const resolvedOldPath = path.resolve(PROJECT_ROOT_API, oldPath);
        const resolvedNewPath = path.resolve(PROJECT_ROOT_API, newPath);
        
        // Security: restrict to project root and subdirectories
        if (!resolvedOldPath.startsWith(PROJECT_ROOT_API) || !resolvedNewPath.startsWith(PROJECT_ROOT_API)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Check if old path exists
        if (!fs.existsSync(resolvedOldPath)) {
            return res.status(404).json({ error: 'File or directory not found' });
        }
        
        // Check if new path already exists
        if (fs.existsSync(resolvedNewPath)) {
            return res.status(409).json({ error: 'Destination already exists' });
        }
        
        // Perform rename with better error handling
        try {
            fs.renameSync(resolvedOldPath, resolvedNewPath);
        } catch (renameErr) {
            // Handle permission errors specifically
            if (renameErr.code === 'EPERM' || renameErr.code === 'EACCES') {
                // Try copy and delete fallback for permission issues
                try {
                    const stats = fs.lstatSync(resolvedOldPath);
                    if (stats.isDirectory()) {
                        copyDirectoryRecursive(resolvedOldPath, resolvedNewPath);
                        fs.rmSync(resolvedOldPath, { recursive: true, force: true });
                    } else {
                        fs.copyFileSync(resolvedOldPath, resolvedNewPath);
                        fs.unlinkSync(resolvedOldPath);
                    }
                } catch (fallbackErr) {
                    throw new Error(`Permission denied: Unable to rename file from '${resolvedOldPath}' to '${resolvedNewPath}'. This may be due to Windows security restrictions on system directories or insufficient permissions.`);
                }
            } else {
                throw renameErr;
            }
        }
        
        res.json({ 
            success: true, 
            message: 'Renamed successfully' 
        });
        
    } catch (err) {
        console.error('Rename error:', err);
        
        // Provide more specific error messages for common issues
        let errorMessage = err.message;
        if (err.code === 'EPERM') {
            errorMessage = `Permission denied: Unable to rename file. This may be due to Windows security restrictions. Try renaming the file in a different location or running the application as administrator.`;
        } else if (err.code === 'EACCES') {
            errorMessage = `Access denied: Unable to rename file. The file may be in use or you may not have sufficient permissions.`;
        } else if (err.code === 'EBUSY') {
            errorMessage = `File is in use: Unable to rename file because it is currently being used by another process.`;
        }
        
        res.status(500).json({ error: errorMessage });
    }
});

// Delete file or directory
app.post('/api/delete', (req, res) => {
    try {
        const { path: deletePath } = req.body;
        
        if (!deletePath) {
            return res.status(400).json({ error: 'Path is required' });
        }
        
        const resolvedPath = path.resolve(PROJECT_ROOT_API, deletePath);
        
        // Security: restrict to project root and subdirectories
        if (!resolvedPath.startsWith(PROJECT_ROOT_API)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Check if path exists
        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ error: 'File or directory not found' });
        }
        
        // Check if trying to delete current directory or parent
        const currentPath = req.body.currentPath || '.';
        function computeParent(path) {
            if (path === '.') return '.';
            const parts = path.split('/');
            parts.pop();
            return parts.join('/') || '.';
        }
        
        if (resolvedPath === path.resolve(PROJECT_ROOT_API, currentPath) || 
            resolvedPath === path.resolve(PROJECT_ROOT_API, computeParent(currentPath))) {
            return res.status(400).json({ error: 'Cannot delete current or parent directory' });
        }
        
        // Perform deletion (recursive for directories)
        const stats = fs.lstatSync(resolvedPath);
        if (stats.isDirectory()) {
            fs.rmSync(resolvedPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(resolvedPath);
        }
        
        res.json({ 
            success: true, 
            message: 'Deleted successfully' 
        });
        
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Copy file or directory
app.post('/api/copy', (req, res) => {
    try {
        const { sourcePath, targetPath, operation } = req.body;
        
        if (!sourcePath || !targetPath) {
            return res.status(400).json({ error: 'Source path and target path are required' });
        }
        
        const resolvedSourcePath = path.resolve(PROJECT_ROOT_API, sourcePath);
        const resolvedTargetPath = path.resolve(PROJECT_ROOT_API, targetPath);
        
        // Security: restrict to project root and subdirectories
        if (!resolvedSourcePath.startsWith(PROJECT_ROOT_API) || !resolvedTargetPath.startsWith(PROJECT_ROOT_API)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Check if source exists
        if (!fs.existsSync(resolvedSourcePath)) {
            return res.status(404).json({ error: 'Source file or directory not found' });
        }
        
        // Check if target is a directory and adjust the path accordingly
        let finalTargetPath = resolvedTargetPath;
        if (fs.existsSync(resolvedTargetPath) && fs.statSync(resolvedTargetPath).isDirectory()) {
            // If target is a directory, append the source filename
            const sourceFilename = path.basename(resolvedSourcePath);
            finalTargetPath = path.join(resolvedTargetPath, sourceFilename);
        }
        
        // Ensure target directory exists
        const targetDir = path.dirname(finalTargetPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // Generate unique target name if it already exists
        let counter = 1;
        while (fs.existsSync(finalTargetPath)) {
            const ext = path.extname(finalTargetPath);
            const nameWithoutExt = path.basename(finalTargetPath, ext);
            finalTargetPath = path.join(path.dirname(finalTargetPath), `${nameWithoutExt} (${counter})${ext}`);
            counter++;
        }
        
        // Perform copy (recursive for directories)
        const stats = fs.lstatSync(resolvedSourcePath);
        if (stats.isDirectory()) {
            copyDirectoryRecursive(resolvedSourcePath, finalTargetPath);
        } else {
            fs.copyFileSync(resolvedSourcePath, finalTargetPath);
        }
        
        res.json({ 
            success: true, 
            message: 'Copied successfully' 
        });
        
    } catch (err) {
        console.error('Copy error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Cut (move) file or directory
app.post('/api/cut', (req, res) => {
    try {
        const { sourcePath, targetPath, operation } = req.body;
        
        if (!sourcePath || !targetPath) {
            return res.status(400).json({ error: 'Source path and target path are required' });
        }
        
        const resolvedSourcePath = path.resolve(PROJECT_ROOT_API, sourcePath);
        const resolvedTargetPath = path.resolve(PROJECT_ROOT_API, targetPath);
        
        // Security: restrict to project root and subdirectories
        if (!resolvedSourcePath.startsWith(PROJECT_ROOT_API) || !resolvedTargetPath.startsWith(PROJECT_ROOT_API)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Check if source exists
        if (!fs.existsSync(resolvedSourcePath)) {
            return res.status(404).json({ error: 'Source file or directory not found' });
        }
        
        // Check if target is a directory and adjust the path accordingly
        let finalTargetPath = resolvedTargetPath;
        if (fs.existsSync(resolvedTargetPath) && fs.statSync(resolvedTargetPath).isDirectory()) {
            // If target is a directory, append the source filename
            const sourceFilename = path.basename(resolvedSourcePath);
            finalTargetPath = path.join(resolvedTargetPath, sourceFilename);
        }
        
        // Ensure target directory exists
        const targetDir = path.dirname(finalTargetPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        
        // Generate unique target name if it already exists
        let counter = 1;
        while (fs.existsSync(finalTargetPath)) {
            const ext = path.extname(finalTargetPath);
            const nameWithoutExt = path.basename(finalTargetPath, ext);
            finalTargetPath = path.join(path.dirname(finalTargetPath), `${nameWithoutExt} (${counter})${ext}`);
            counter++;
        }
        
        // Perform move (rename) with better error handling
        try {
            fs.renameSync(resolvedSourcePath, finalTargetPath);
        } catch (renameErr) {
            // Handle permission errors specifically
            if (renameErr.code === 'EPERM' || renameErr.code === 'EACCES') {
                // Try copy and delete fallback for permission issues
                try {
                    const stats = fs.lstatSync(resolvedSourcePath);
                    if (stats.isDirectory()) {
                        copyDirectoryRecursive(resolvedSourcePath, finalTargetPath);
                        fs.rmSync(resolvedSourcePath, { recursive: true, force: true });
                    } else {
                        fs.copyFileSync(resolvedSourcePath, finalTargetPath);
                        fs.unlinkSync(resolvedSourcePath);
                    }
                } catch (fallbackErr) {
                    throw new Error(`Permission denied: Unable to move file from '${resolvedSourcePath}' to '${finalTargetPath}'. This may be due to Windows security restrictions on system directories or insufficient permissions.`);
                }
            } else {
                throw renameErr;
            }
        }
        
        res.json({ 
            success: true, 
            message: 'Moved successfully' 
        });
        
    } catch (err) {
        console.error('Cut error:', err);
        
        // Provide more specific error messages for common issues
        let errorMessage = err.message;
        if (err.code === 'EPERM') {
            errorMessage = `Permission denied: Unable to move file. This may be due to Windows security restrictions. Try moving the file to a different location or running the application as administrator.`;
        } else if (err.code === 'EACCES') {
            errorMessage = `Access denied: Unable to move file. The file may be in use or you may not have sufficient permissions.`;
        } else if (err.code === 'EBUSY') {
            errorMessage = `File is in use: Unable to move file because it is currently being used by another process.`;
        }
        
        res.status(500).json({ error: errorMessage });
    }
});

// Helper function to copy directory recursively
function copyDirectoryRecursive(source, target) {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }
    
    const files = fs.readdirSync(source);
    files.forEach(file => {
        const sourcePath = path.join(source, file);
        const targetPath = path.join(target, file);
        
        const stats = fs.lstatSync(sourcePath);
        if (stats.isDirectory()) {
            copyDirectoryRecursive(sourcePath, targetPath);
        } else {
            fs.copyFileSync(sourcePath, targetPath);
        }
    });
}

app.listen(PORT, () => {
    console.log(`File explorer server running at http://localhost:${PORT}`);
});
