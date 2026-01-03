package main

import (
	"fmt"
	"runtime"
)

var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

func main() {
	fmt.Printf("gnomo %s (%s) %s\n", version, commit, date)
	fmt.Printf("go=%s os=%s arch=%s\n", runtime.Version(), runtime.GOOS, runtime.GOARCH)
}
