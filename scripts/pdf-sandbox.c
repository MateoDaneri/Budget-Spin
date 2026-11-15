/* Restrict a PDF worker to its existing stdin/stdout; no network sockets or
 * io_uring network bypass. The Node permission model adds filesystem/exec limits.
 * Fail closed on unsupported CPU architectures or any setup failure. */
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
#define NATIVE_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define NATIVE_ARCH AUDIT_ARCH_AARCH64
#else
#error Unsupported architecture
#endif
#define DENY(nr) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, (nr), 0, 1), BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO | EPERM)
int main(int argc, char **argv) {
 if (argc < 2) return 125;
 /* V8 reserves virtual address space; 1.5 GiB leaves room for its 128 MiB
  * heap while limiting native buffers. No core dumps or file output. */
 struct rlimit vm = { 1536ULL*1024*1024, 1536ULL*1024*1024 };
 struct rlimit core = { 0, 0 }, file = { 0, 0 }, cpu = { 8, 10 }, fds = { 64, 64 };
 if (setrlimit(RLIMIT_AS,&vm) || setrlimit(RLIMIT_CORE,&core) || setrlimit(RLIMIT_FSIZE,&file) || setrlimit(RLIMIT_CPU,&cpu) || setrlimit(RLIMIT_NOFILE,&fds)) return 126;
 struct sock_filter rules[] = {
  BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, arch)),
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, NATIVE_ARCH, 1, 0),
  BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
  BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
  BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K, 0x40000000, 0, 1),
  BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
  DENY(__NR_socket), DENY(__NR_socketpair), DENY(__NR_connect), DENY(__NR_bind), DENY(__NR_listen),
  DENY(__NR_accept), DENY(__NR_accept4), DENY(__NR_sendto), DENY(__NR_recvfrom), DENY(__NR_sendmsg), DENY(__NR_recvmsg),
#ifdef __NR_sendmmsg
  DENY(__NR_sendmmsg),
#endif
#ifdef __NR_recvmmsg
  DENY(__NR_recvmmsg),
#endif
#ifdef __NR_io_uring_setup
  DENY(__NR_io_uring_setup),
#endif
  BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW)
 };
 struct sock_fprog prog = { .len = (unsigned short)(sizeof(rules)/sizeof(rules[0])), .filter = rules };
 if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog)) return 126;
 execv(argv[1], argv + 1); return 127;
}
