# 文件上传与下载

> 文件处理是 Web 应用的常见需求：头像上传、报表导出、文档预览。Spring MVC 通过 `MultipartFile` 封装上传，通过 `Resource` 抽象下载。这一章覆盖单文件/多文件上传、大文件流式处理、断点续传，以及生产环境的安全和性能要点。

## 1. 文件上传

### 1.1 基础配置

```yaml
# application.yml
spring:
  servlet:
    multipart:
      enabled: true
      max-file-size: 10MB          # 单文件大小限制
      max-request-size: 50MB       # 总请求大小限制
      file-size-threshold: 2KB     # 超过此大小写入临时文件
      location: /tmp               # 临时文件目录
```

### 1.2 单文件上传

```java
@RestController
@RequestMapping("/api/files")
public class FileController {

    @Value("${app.upload.dir:${user.home}/uploads}")
    private String uploadDir;

    @PostMapping("/upload")
    public FileInfo upload(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            throw new IllegalArgumentException("文件不能为空");
        }

        // 文件信息
        String originalName = file.getOriginalFilename();
        String contentType = file.getContentType();
        long size = file.getSize();

        // 生成唯一文件名，保留扩展名
        String ext = StringUtils.getFilenameExtension(originalName);
        String storedName = UUID.randomUUID() + "." + ext;

        // 保存文件
        Path target = Path.of(uploadDir, storedName);
        file.transferTo(target.toFile());

        return new FileInfo(originalName, storedName, contentType, size);
    }
}
```

### 1.3 多文件上传

```java
@PostMapping("/upload/batch")
public List<FileInfo> uploadBatch(
        @RequestParam("files") List<MultipartFile> files) {

    return files.stream()
            .filter(f -> !f.isEmpty())
            .map(this::saveFile)
            .toList();
}
```

### 1.4 与实体关联

```java
@RestController
@RequestMapping("/api/users/{userId}/avatar")
public class AvatarController {

    @PostMapping
    public User updateAvatar(
            @PathVariable Long userId,
            @RequestParam("file") MultipartFile file) {

        // 上传文件
        String storedName = saveFile(file);

        // 更新用户头像字段
        User user = userService.findById(userId);
        user.setAvatarUrl("/api/files/" + storedName);
        return userService.save(user);
    }
}
```

## 2. 大文件上传

### 2.1 流式处理（避免内存溢出）

`MultipartFile.transferTo()` 会将整个文件加载到内存或临时文件。大文件应使用流式写入：

```java
@PostMapping("/upload/stream")
public FileInfo uploadStream(@RequestParam("file") MultipartFile file) {
    String storedName = generateStoredName(file);
    Path target = Path.of(uploadDir, storedName);

    // 流式写入，不在内存中缓冲整个文件
    try (InputStream in = file.getInputStream();
         OutputStream out = Files.newOutputStream(target)) {
        byte[] buffer = new byte[8192];
        int bytesRead;
        while ((bytesRead = in.read(buffer)) != -1) {
            out.write(buffer, 0, bytesRead);
        }
    } catch (IOException e) {
        throw new FileUploadException("文件保存失败", e);
    }

    return new FileInfo(file.getOriginalFilename(), storedName,
                        file.getContentType(), file.getSize());
}
```

### 2.2 分片上传

大文件（>100MB）建议前端分片上传：

```java
@RestController
@RequestMapping("/api/files/chunk")
public class ChunkUploadController {

    // 上传分片
    @PostMapping
    public ChunkResult uploadChunk(
            @RequestParam("file") MultipartFile chunk,
            @RequestParam("uploadId") String uploadId,
            @RequestParam("chunkNumber") int chunkNumber,
            @RequestParam("totalChunks") int totalChunks) {

        Path chunkDir = Path.of(uploadDir, "chunks", uploadId);
        Files.createDirectories(chunkDir);

        Path chunkPath = chunkDir.resolve("chunk_" + chunkNumber);
        chunk.transferTo(chunkPath.toFile());

        return new ChunkResult(uploadId, chunkNumber, true);
    }

    // 合并分片
    @PostMapping("/merge")
    public FileInfo mergeChunks(
            @RequestParam("uploadId") String uploadId,
            @RequestParam("fileName") String fileName,
            @RequestParam("totalChunks") int totalChunks) {

        Path chunkDir = Path.of(uploadDir, "chunks", uploadId);
        String ext = StringUtils.getFilenameExtension(fileName);
        String storedName = UUID.randomUUID() + "." + ext;
        Path target = Path.of(uploadDir, storedName);

        try (OutputStream out = Files.newOutputStream(target)) {
            for (int i = 0; i < totalChunks; i++) {
                Path chunkPath = chunkDir.resolve("chunk_" + i);
                Files.copy(chunkPath, out);
            }
        } catch (IOException e) {
            throw new FileUploadException("合并失败", e);
        }

        // 清理分片
        FileUtils.deleteDirectory(chunkDir.toFile());

        return new FileInfo(fileName, storedName, null, Files.size(target));
    }
}
```

## 3. 文件下载

### 3.1 基础下载

```java
@GetMapping("/download/{filename}")
public ResponseEntity<Resource> download(@PathVariable String filename) {
    Path filePath = Path.of(uploadDir, filename);
    Resource resource = new FileSystemResource(filePath);

    if (!resource.exists()) {
        throw new ResourceNotFoundException("文件不存在: " + filename);
    }

    return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=\"" + filename + "\"")
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .body(resource);
}
```

### 3.2 支持 Range 请求（断点续传/视频拖拽）

```java
@GetMapping("/stream/{filename}")
public ResponseEntity<ResourceRegion> stream(
        @PathVariable String filename,
        @RequestHeader HttpHeaders headers) {

    Resource resource = new FileSystemResource(Path.of(uploadDir, filename));
    long fileLength = resource.contentLength();

    // 解析 Range 头
    List<HttpRange> headers.getRange();
    if (ranges.isEmpty()) {
        // 无 Range，返回完整文件
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(new ResourceRegion(resource, 0, fileLength));
    }

    // 返回第一个 Range（浏览器通常只请求一个）
    HttpRange range = ranges.get(0);
    long start = range.getRangeStart(fileLength);
    long end = range.getRangeEnd(fileLength);
    long rangeLength = Math.min(1024 * 1024 * 10, end - start + 1);  // 每次最多 10MB

    return ResponseEntity.status(HttpStatus.PARTIAL_CONTENT)
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header(HttpHeaders.ACCEPT_RANGES, "bytes")
            .header(HttpHeaders.CONTENT_RANGE,
                    "bytes " + start + "-" + (start + rangeLength - 1) + "/" + fileLength)
            .body(new ResourceRegion(resource, start, rangeLength));
}
```

### 3.3 图片在线预览

```java
@GetMapping("/image/{filename}")
public ResponseEntity<Resource> preview(@PathVariable String filename) {
    Resource resource = new FileSystemResource(Path.of(uploadDir, filename));

    // Content-Disposition: inline 让浏览器直接显示而非下载
    return ResponseEntity.ok()
            .contentType(MediaType.IMAGE_PNG)
            .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
            .body(resource);
}
```

## 4. 存储抽象

本地文件系统不适合生产环境。抽象存储接口，支持多种后端：

```java
public interface StorageService {
    String store(MultipartFile file);
    Resource load(String filename);
    void delete(String filename);
}

// 本地实现
@Service
public class LocalStorageService implements StorageService {
    @Value("${app.upload.dir}")
    private String uploadDir;

    @Override
    public String store(MultipartFile file) {
        String name = UUID.randomUUID() + "." +
                      StringUtils.getFilenameExtension(file.getOriginalFilename());
        file.transferTo(Path.of(uploadDir, name).toFile());
        return name;
    }

    @Override
    public Resource load(String filename) {
        Resource resource = new FileSystemResource(Path.of(uploadDir, filename));
        if (!resource.exists()) throw new ResourceNotFoundException(filename);
        return resource;
    }
}

// OSS 实现
@Service
public class OssStorageService implements StorageService {
    @Autowired
    private AmazonS3 s3Client;

    @Value("${app.oss.bucket}")
    private String bucket;

    @Override
    public String store(MultipartFile file) {
        String key = "uploads/" + UUID.randomUUID() + "." +
                     StringUtils.getFilenameExtension(file.getOriginalFilename());
        ObjectMetadata metadata = new ObjectMetadata();
        metadata.setContentType(file.getContentType());
        metadata.setContentLength(file.getSize());
        s3Client.putObject(bucket, key, file.getInputStream(), metadata);
        return key;
    }

    @Override
    public Resource load(String filename) {
        S3Object object = s3Client.getObject(bucket, "uploads/" + filename);
        return new InputStreamResource(object.getObjectContent());
    }
}
```

## 5. 安全与校验

```java
@Component
public class FileValidator {

    private static final Set<String> ALLOWED_EXTENSIONS =
            Set.of("jpg", "jpeg", "png", "gif", "pdf", "docx");

    private static final long MAX_SIZE = 10 * 1024 * 1024;  // 10MB

    public void validate(MultipartFile file) {
        // 1. 检查文件名（防止路径遍历攻击）
        String name = file.getOriginalFilename();
        if (name != null && (name.contains("..") || name.contains("/"))) {
            throw new SecurityException("非法文件名");
        }

        // 2. 检查扩展名
        String ext = StringUtils.getFilenameExtension(name);
        if (ext == null || !ALLOWED_EXTENSIONS.contains(ext.toLowerCase())) {
            throw new SecurityException("不允许的文件类型: " + ext);
        }

        // 3. 检查大小
        if (file.getSize() > MAX_SIZE) {
            throw new SecurityException("文件大小超过限制");
        }

        // 4. 检查 MIME 类型（比扩展名更可靠）
        String contentType = file.getContentType();
        if (!isAllowedContentType(contentType)) {
            throw new SecurityException("不允许的内容类型: " + contentType);
        }

        // 5. 检查文件魔数（Magic Number）
        if (!verifyMagicNumber(file)) {
            throw new SecurityException("文件内容与扩展名不匹配");
        }
    }
}
```

**最佳实践：**

1. **文件名永远不可信**——用 UUID 重命名，保留原名仅用于显示
2. **校验 MIME + 魔数**——扩展名可以伪造，魔数不能
3. **上传目录禁止执行**——确保上传目录没有脚本执行权限
4. **大文件用分片**——>100MB 建议分片上传，支持断点续传
5. **存储抽象**——本地文件系统只适合开发，生产用 OSS/S3/MinIO
6. **CDN 加速**——静态文件通过 CDN 分发，减轻应用服务器压力
