//go:build windows

package tmux

// killProcessGroup is a no-op on Windows; tmux and POSIX process groups are not available.
func killProcessGroup(_ string) {}
