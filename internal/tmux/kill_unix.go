//go:build !windows

package tmux

import (
	"strconv"
	"syscall"
	"time"
)

// killProcessGroup sends SIGTERM then SIGKILL to a process group identified by pgid string.
// On POSIX systems this uses syscall.Kill with a negative PID to target the group.
func killProcessGroup(pgid string) {
	pgidInt, err := strconv.Atoi(pgid)
	if err != nil || pgidInt <= 1 {
		return
	}
	_ = syscall.Kill(-pgidInt, syscall.SIGTERM)
	time.Sleep(100 * time.Millisecond)
	_ = syscall.Kill(-pgidInt, syscall.SIGKILL)
}
