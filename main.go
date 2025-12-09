package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"time"

	"github.com/joho/godotenv"
	"github.com/rs/cors"
)

// Config holds application configuration
type Config struct {
	Port           string
	OpenAIAPIKey   string
	CookiesFile    string
}

// TranscribeRequest represents the incoming transcription request
type TranscribeRequest struct {
	URL string `json:"url"`
}

// TranscribeResponse represents the transcription response
type TranscribeResponse struct {
	OK         bool            `json:"ok"`
	URL        string          `json:"url"`
	Video      VideoMetadata   `json:"video"`
	Transcript TranscriptData  `json:"transcript"`
}

// VideoMetadata represents metadata about the video
type VideoMetadata struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Channel     string `json:"channel"`
	ChannelURL  string `json:"channel_url"`
	Duration    int    `json:"duration"` // in seconds
	UploadDate  string `json:"upload_date"`
	ViewCount   int64  `json:"view_count"`
	Thumbnail   string `json:"thumbnail"`
}

// TranscriptData represents the transcript data with segments
type TranscriptData struct {
	Text     string             `json:"text"`     // Full transcript text
	Segments []TranscriptSegment `json:"segments"` // Timestamped segments
	Language string             `json:"language"` // Detected language
	Duration float64            `json:"duration"` // Duration in seconds
}

// TranscriptSegment represents a timestamped segment of the transcript
type TranscriptSegment struct {
	ID    int     `json:"id"`
	Start float64 `json:"start"` // Start time in seconds
	End   float64 `json:"end"`   // End time in seconds
	Text  string  `json:"text"`
}

// HealthResponse represents the health check response
type HealthResponse struct {
	OK      bool   `json:"ok"`
	Service string `json:"service"`
	Time    string `json:"time"`
}

// ErrorResponse represents an error response
type ErrorResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

var config Config

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found, using system environment variables")
	}

	// Initialize configuration
	config = Config{
		Port:         getEnv("PORT", "5055"),
		OpenAIAPIKey: getEnv("OPENAI_API_KEY", ""),
		CookiesFile:  getEnv("YTDLP_COOKIES_FILE", ""),
	}

	if config.OpenAIAPIKey == "" {
		log.Fatal("OPENAI_API_KEY environment variable is required")
	}

	// Create router
	mux := http.NewServeMux()

	// Register routes
	mux.HandleFunc("/api/health", healthHandler)
	mux.HandleFunc("/api/transcribe", transcribeHandler)

	// Setup CORS
	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	}).Handler(mux)

	// Start server
	addr := ":" + config.Port
	log.Printf("Server starting on port %s", config.Port)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}

// healthHandler handles the health check endpoint
func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response := HealthResponse{
		OK:      true,
		Service: "phoenix-backend-transcriber",
		Time:    time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// transcribeHandler handles the transcription endpoint
func transcribeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req TranscribeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate URL
	if !isValidYouTubeURL(req.URL) {
		sendError(w, "Invalid YouTube URL", http.StatusBadRequest)
		return
	}

	// Create temporary directory
	tempDir, err := os.MkdirTemp("", "avi-transcribe-*")
	if err != nil {
		log.Printf("Error creating temp directory: %v", err)
		sendError(w, "Failed to create temporary directory", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(tempDir)

	// Get video metadata
	metadata, err := getVideoMetadata(req.URL)
	if err != nil {
		log.Printf("Error fetching video metadata: %v", err)
		sendError(w, fmt.Sprintf("Failed to fetch video metadata: %v", err), http.StatusInternalServerError)
		return
	}

	// Download audio from YouTube
	audioFile, err := downloadYouTubeAudio(req.URL, tempDir)
	if err != nil {
		log.Printf("Error downloading YouTube audio: %v", err)
		sendError(w, fmt.Sprintf("Failed to download YouTube audio: %v", err), http.StatusInternalServerError)
		return
	}

	// Transcribe audio using OpenAI Whisper with timestamps
	transcript, err := transcribeAudioWithTimestamps(audioFile)
	if err != nil {
		log.Printf("Error transcribing audio: %v", err)
		sendError(w, fmt.Sprintf("Failed to transcribe audio: %v", err), http.StatusInternalServerError)
		return
	}

	// Send response
	response := TranscribeResponse{
		OK:         true,
		URL:        req.URL,
		Video:      metadata,
		Transcript: transcript,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// getVideoMetadata fetches video metadata using yt-dlp
func getVideoMetadata(url string) (VideoMetadata, error) {
	// Use yt-dlp to get video info as JSON
	args := []string{
		"--dump-json",
		"--no-playlist",
		"--skip-download",
		"--extractor-args", "youtube:player_client=android,web",
		"--no-check-certificates",
		url,
	}

	cmd := exec.Command("yt-dlp", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return VideoMetadata{}, fmt.Errorf("yt-dlp failed to fetch metadata: %v, output: %s", err, string(output))
	}

	// Parse the JSON output
	var videoInfo struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Uploader    string `json:"uploader"`
		UploaderURL string `json:"uploader_url"`
		Duration    int    `json:"duration"`
		UploadDate  string `json:"upload_date"`
		ViewCount   int64  `json:"view_count"`
		Thumbnail   string `json:"thumbnail"`
	}

	if err := json.Unmarshal(output, &videoInfo); err != nil {
		return VideoMetadata{}, fmt.Errorf("failed to parse video metadata: %v", err)
	}

	metadata := VideoMetadata{
		Title:       videoInfo.Title,
		Description: videoInfo.Description,
		Channel:     videoInfo.Uploader,
		ChannelURL:  videoInfo.UploaderURL,
		Duration:    videoInfo.Duration,
		UploadDate:  videoInfo.UploadDate,
		ViewCount:   videoInfo.ViewCount,
		Thumbnail:   videoInfo.Thumbnail,
	}

	return metadata, nil
}

// downloadYouTubeAudio downloads audio from a YouTube URL using yt-dlp
func downloadYouTubeAudio(url, tempDir string) (string, error) {
	outputPath := filepath.Join(tempDir, "audio.mp3")

	// Build yt-dlp command arguments with OAuth support
	args := []string{
		"-x",                    // Extract audio
		"--audio-format", "mp3", // Convert to MP3
		"-o", outputPath,        // Output path
		"--no-playlist",         // Don't download playlists
		"--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"--extractor-args", "youtube:player_client=android,web",  // Use mobile client to avoid restrictions
		"--no-check-certificates", // Skip SSL verification issues
	}

	// Add cookies file if configured
	if config.CookiesFile != "" {
		if _, err := os.Stat(config.CookiesFile); err == nil {
			args = append(args, "--cookies", config.CookiesFile)
		}
	}

	// Add URL as last argument
	args = append(args, url)

	// Execute yt-dlp command
	cmd := exec.Command("yt-dlp", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("yt-dlp failed: %v, output: %s", err, string(output))
	}

	// Verify the file was created
	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return "", fmt.Errorf("audio file was not created")
	}

	return outputPath, nil
}

// transcribeAudioWithTimestamps transcribes an audio file using OpenAI Whisper API with timestamp segments
func transcribeAudioWithTimestamps(audioFilePath string) (TranscriptData, error) {
	// Open audio file
	file, err := os.Open(audioFilePath)
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to open audio file: %v", err)
	}
	defer file.Close()

	// Create multipart form data
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Add file field
	part, err := writer.CreateFormFile("file", filepath.Base(audioFilePath))
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to create form file: %v", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to copy file data: %v", err)
	}

	// Add model field
	if err := writer.WriteField("model", "whisper-1"); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to write model field: %v", err)
	}

	// Add response_format field for verbose_json to get timestamps
	if err := writer.WriteField("response_format", "verbose_json"); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to write response_format field: %v", err)
	}

	// Add timestamp_granularities for segment-level timestamps
	if err := writer.WriteField("timestamp_granularities[]", "segment"); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to write timestamp_granularities field: %v", err)
	}

	// Close writer to finalize multipart data
	if err := writer.Close(); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to close multipart writer: %v", err)
	}

	// Create HTTP request
	req, err := http.NewRequest("POST", "https://api.openai.com/v1/audio/transcriptions", body)
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to create request: %v", err)
	}

	// Set headers
	req.Header.Set("Authorization", "Bearer "+config.OpenAIAPIKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	// Send request
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to send request: %v", err)
	}
	defer resp.Body.Close()

	// Read response
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return TranscriptData{}, fmt.Errorf("failed to read response: %v", err)
	}

	// Check status code
	if resp.StatusCode != http.StatusOK {
		return TranscriptData{}, fmt.Errorf("OpenAI API returned status %d: %s", resp.StatusCode, string(respBody))
	}

	// Parse verbose_json response
	var result struct {
		Text     string `json:"text"`
		Language string `json:"language"`
		Duration float64 `json:"duration"`
		Segments []struct {
			ID    int     `json:"id"`
			Start float64 `json:"start"`
			End   float64 `json:"end"`
			Text  string  `json:"text"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return TranscriptData{}, fmt.Errorf("failed to parse response: %v", err)
	}

	// Convert segments to our format
	segments := make([]TranscriptSegment, len(result.Segments))
	for i, seg := range result.Segments {
		segments[i] = TranscriptSegment{
			ID:    seg.ID,
			Start: seg.Start,
			End:   seg.End,
			Text:  seg.Text,
		}
	}

	transcript := TranscriptData{
		Text:     result.Text,
		Segments: segments,
		Language: result.Language,
		Duration: result.Duration,
	}

	return transcript, nil
}

// isValidYouTubeURL validates if a URL is a valid YouTube URL
func isValidYouTubeURL(url string) bool {
	if url == "" {
		return false
	}

	// Check for youtube.com or youtu.be domains
	youtubePattern := regexp.MustCompile(`(?i)(youtube\.com|youtu\.be)`)
	return youtubePattern.MatchString(url)
}

// sendError sends an error response
func sendError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{
		OK:    false,
		Error: message,
	})
}

// getEnv gets an environment variable with a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
