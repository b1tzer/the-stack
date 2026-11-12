---
type: reference
level: intermediate
---

# Spring 常用注解速查

> 适用 Spring Framework 6.x / Spring Boot 3.x。范围限定在核心容器、Spring Web MVC 与 Spring Boot 启动相关注解；Spring Security、Spring Data、测试注解不在本页，见各自专题。

本页只回答两件事：这个注解做什么，使用它有什么限制或默认行为。用法示例和取舍放在对应专题页面。

## 启动与配置

| 注解 | 作用 | 约束与默认值 |
| :-- | :-- | :-- |
| `@SpringBootApplication` | 组合 `@SpringBootConfiguration`、`@EnableAutoConfiguration`、`@ComponentScan` | 通常标在主启动类上，测试框架靠它定位配置；`exclude`、`scanBasePackages` 通过 `@AliasFor` 转发给被组合的注解 |
| `@EnableAutoConfiguration` | 打开自动配置 | 注册 `AutoConfigurationImportSelector`；`spring.boot.enableautoconfiguration=false` 可整体关闭，`exclude`/`excludeName` 排除单个配置类 |
| `@ComponentScan` | 扫描组件 | 默认扫描注解所在包及子包；可用 `basePackages`、`excludeFilters` 缩小范围 |
| `@Configuration` | 声明配置类 | `proxyBeanMethods` 默认 `true`；设为 `false` 后 `@Bean` 方法之间不能互相调用，只能通过方法参数注入 |
| `@Import` | 导入其他配置 | 可导入配置类、普通类（注册为 Bean）、`ImportSelector` 或 `ImportBeanDefinitionRegistrar` |

## Bean 定义与注入

| 注解 | 作用 | 约束与默认值 |
| :-- | :-- | :-- |
| `@Bean` | 声明 Bean | 默认以方法名作为 Bean 名；方法返回值类型用于 `@ConditionalOnMissingBean` 的推断 |
| `@Component` | 通用组件 | `@Service`、`@Repository`、`@Controller` 都以它为元注解 |
| `@Service` | 业务层组件 | 与 `@Component` 行为相同，只表达分层语义 |
| `@Repository` | 持久层组件 | 在 `@Component` 基础上增加持久层异常转换 |
| `@Autowired` | 按类型注入 | 只有一个构造器时可省略；字段注入无法配合 `final` 字段 |
| `@Qualifier` | 按名称收窄候选 | 与 `@Autowired` 搭配，也可标在 `@Bean` 方法参数上 |
| `@Primary` | 同类型多候选时优先 | 与 `@Qualifier` 同时出现时，`@Qualifier` 的收窄优先 |
| `@Scope` | 指定作用域 | 默认 `singleton`；`prototype` 每次获取都创建新实例 |
| `@Lazy` | 延迟初始化 | 标在注入点上注入的是代理，首次调用才解析目标 Bean |
| `@Value` | 注入单个配置值 | 支持 `${key:default}` 与 SpEL；多层结构改用 `@ConfigurationProperties` |
| `@ConfigurationProperties` | 绑定一组配置 | 必须注册为 Bean：`@EnableConfigurationProperties`、`@ConfigurationPropertiesScan` 或 `@Component` 三者之一 |
| `@Profile` | 按环境生效 | 未激活任何 profile 时，只有声明为 `default` 的 `@Profile` Bean 生效；未标注的 Bean 始终生效 |

## Web 请求处理

| 注解 | 作用 | 约束与默认值 |
| :-- | :-- | :-- |
| `@Controller` | MVC 控制器 | 返回值走视图解析；返回 JSON 用 `@RestController` |
| `@RestController` | 返回值直接写入响应体 | 等于 `@Controller` 加 `@ResponseBody` |
| `@RequestMapping` | 映射请求路径 | 可标在类和方法上，两级路径拼接 |
| `@GetMapping` / `@PostMapping` | 限定 HTTP 方法的映射 | 等价于 `@RequestMapping(method = ...)`；同类还有 `@PutMapping`、`@DeleteMapping`、`@PatchMapping` |
| `@PathVariable` | 提取路径变量 | 参数名依赖 `-parameters` 编译参数，名字不一致时显式写 `value` |
| `@RequestParam` | 提取查询参数 | `required` 默认 `true`，缺失时返回 400；可用 `defaultValue` 放宽 |
| `@RequestBody` | 绑定请求体 | 依赖 `HttpMessageConverter`；`Content-Type` 缺失或不支持时返回 415 |
| `@ResponseStatus` | 指定响应状态码 | 标在处理方法或异常类上；标在异常类上时由异常处理器读取 |

## 事务、缓存与异步

| 注解 | 作用 | 约束与默认值 |
| :-- | :-- | :-- |
| `@Transactional` | 声明式事务 | 基于代理，同一个类内部的自调用不生效；默认只对 `RuntimeException` 和 `Error` 回滚 |
| `@Cacheable` / `@CacheEvict` | 读取时缓存、失效时清除 | 需要 `@EnableCaching`；同类内部调用不经过代理，注解不生效 |
| `@Async` | 异步执行 | 需要 `@EnableAsync`；返回 `void`、`Future` 或 `CompletableFuture`，同类内部调用不生效 |
| `@Scheduled` | 定时执行 | 需要 `@EnableScheduling`；方法不接受参数，通常返回 `void` |

## 校验与异常

| 注解 | 作用 | 约束与默认值 |
| :-- | :-- | :-- |
| `@Validated` | 触发方法参数校验 | 标在类上启用方法级校验；分组校验用它指定分组 |
| `@Valid` | 级联校验 | 标在字段或方法参数上；嵌套对象需要逐层标注 |
| `@ExceptionHandler` | 处理指定异常 | 只对所在控制器生效；全局处理放到 `@ControllerAdvice` 类 |
| `@ControllerAdvice` | 全局异常与绑定处理 | 可用 `basePackages`、`annotations` 限定生效范围 |

查不到需要的注解时，先看它是否属于本页声明的范围；Spring Security、Spring Data、测试相关注解在各自专题里查。
