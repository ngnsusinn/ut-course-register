-- phpMyAdmin SQL Dump
-- version 5.2.0
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Oct 25, 2025 at 07:14 AM
-- Server version: 5.7.41-cll-lve
-- PHP Version: 7.2.34

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `roacqgfa_reg`
--

-- --------------------------------------------------------

--
-- Table structure for table `activity_logs`
--

CREATE TABLE `activity_logs` (
  `id` int(11) NOT NULL,
  `user_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `details` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `activity_logs`
--

INSERT INTO `activity_logs` (`id`, `user_id`, `action`, `details`, `created_at`) VALUES
(1, '054206005638', 'VIP_PURCHASE', 'Purchased 1 Ngày VIP - Order #6', '2025-10-24 06:59:19'),
(2, '054206005638', 'VIP_PURCHASE', 'Purchased 1 Ngày VIP - Order #8', '2025-10-24 07:14:51'),
(3, '054206005638', 'VIP_PURCHASE', 'Purchased 1 Ngày VIP - Order #10', '2025-10-24 08:04:16'),
(4, '083306005200', 'VIP_PURCHASE', 'Purchased 1 Ngày VIP - Order #13', '2025-10-24 09:05:50');

-- --------------------------------------------------------

--
-- Table structure for table `orders`
--

CREATE TABLE `orders` (
  `id` bigint(20) NOT NULL,
  `user_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_status` enum('Unpaid','Paid','Cancelled') COLLATE utf8mb4_unicode_ci DEFAULT 'Unpaid',
  `transaction_ref` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `orders`
--

INSERT INTO `orders` (`id`, `user_id`, `plan_type`, `plan_name`, `amount`, `payment_status`, `transaction_ref`, `created_at`, `paid_at`) VALUES
(1, '054206005638', '1day', '1 Ngày VIP', '10000.00', 'Unpaid', NULL, '2025-10-24 06:45:09', NULL),
(2, '054206005638', '3days', '3 Ngày VIP', '25000.00', 'Unpaid', NULL, '2025-10-24 06:46:04', NULL),
(3, '054206005638', '1day', '1 Ngày VIP', '10000.00', 'Unpaid', NULL, '2025-10-24 06:48:42', NULL),
(4, '054206005638', '1day', '1 Ngày VIP', '10000.00', 'Unpaid', NULL, '2025-10-24 06:52:13', NULL),
(5, '054206005638', '1day', '1 Ngày VIP', '10000.00', 'Unpaid', NULL, '2025-10-24 06:53:41', NULL),
(6, '054206005638', '1day', '1 Ngày VIP', '10000.00', 'Paid', 'FT25297570402800', '2025-10-24 06:59:01', '2025-10-24 06:59:18'),
(7, '054206005638', '1day', '1 Ngày VIP', '10000.00', 'Unpaid', NULL, '2025-10-24 07:13:15', NULL),
(8, '054206005638', '1day', '1 Ngày VIP', '10000.00', 'Paid', 'FT25297781271950', '2025-10-24 07:14:23', '2025-10-24 07:14:50'),
(9, '054206005638', '7days', '7 Ngày VIP', '50000.00', 'Unpaid', NULL, '2025-10-24 08:03:37', NULL),
(10, '054206005638', '1day', '1 Ngày VIP', '10000.00', 'Paid', 'FT25297012526909', '2025-10-24 08:03:45', '2025-10-24 08:04:15'),
(11, '083306005200', '1day', '1 Ngày VIP', '24000.00', 'Unpaid', NULL, '2025-10-24 09:03:45', NULL),
(12, '083306005200', '30days', '30 Ngày VIP', '432000.00', 'Unpaid', NULL, '2025-10-24 09:03:51', NULL),
(13, '083306005200', '1day', '1 Ngày VIP', '24000.00', 'Paid', 'FT25297006624474', '2025-10-24 09:04:02', '2025-10-24 09:05:48'),
(14, '054206005638', '1day', '1 Ngày VIP', '10000.00', 'Unpaid', NULL, '2025-10-24 11:39:55', NULL),
(15, '054206005638', '7days', '7 Ngày VIP', '50000.00', 'Unpaid', NULL, '2025-10-24 11:59:57', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` int(11) NOT NULL,
  `gateway` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `transaction_date` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sub_account` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount_in` decimal(15,2) DEFAULT '0.00',
  `amount_out` decimal(15,2) DEFAULT '0.00',
  `accumulated` decimal(15,2) DEFAULT '0.00',
  `code` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transaction_content` text COLLATE utf8mb4_unicode_ci,
  `reference_number` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body` text COLLATE utf8mb4_unicode_ci,
  `order_id` bigint(20) DEFAULT NULL,
  `received_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `transactions`
--

INSERT INTO `transactions` (`id`, `gateway`, `transaction_date`, `account_number`, `sub_account`, `amount_in`, `amount_out`, `accumulated`, `code`, `transaction_content`, `reference_number`, `body`, `order_id`, `received_at`) VALUES
(1, 'MBBank', '2025-10-24 13:59:00', '01006022006', '', '10000.00', '0.00', '0.00', 'DH6', 'DH6', 'FT25297570402800', 'BankAPINotify DH6', 6, '2025-10-24 06:59:17'),
(2, 'MBBank', '2025-10-24 14:14:00', '01006022006', '', '10000.00', '0.00', '0.00', 'DH8', 'DH8', 'FT25297781271950', 'BankAPINotify DH8', 8, '2025-10-24 07:14:50'),
(3, 'MBBank', '2025-10-24 15:04:00', '01006022006', '', '10000.00', '0.00', '0.00', 'DH10', 'DH10', 'FT25297012526909', 'BankAPINotify DH10', 10, '2025-10-24 08:04:14'),
(4, 'MBBank', '2025-10-24 16:04:00', '01006022006', '', '23000.00', '0.00', '0.00', 'DH13', 'DH13', 'FT25297949134060', 'BankAPINotify DH13', 13, '2025-10-24 09:04:53'),
(5, 'MBBank', '2025-10-24 16:05:00', '01006022006', '', '24000.00', '0.00', '0.00', 'DH13', 'DH13', 'FT25297006624474', 'BankAPINotify DH13', 13, '2025-10-24 09:05:48');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `vip_subscriptions`
--

CREATE TABLE `vip_subscriptions` (
  `id` int(11) NOT NULL,
  `user_id` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiry_date` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `vip_subscriptions`
--

INSERT INTO `vip_subscriptions` (`id`, `user_id`, `plan_type`, `expiry_date`, `created_at`, `updated_at`) VALUES
(1, '054206005638', '1day', '2025-10-01 00:00:00', '2025-10-24 06:59:19', '2025-10-24 07:04:33'),
(2, '054206005638', '1day', '2009-12-31 07:14:51', '2025-10-24 07:14:51', '2025-10-24 08:03:14'),
(3, '054206005638', '1day', '2025-10-31 23:04:14', '2025-10-24 08:04:15', '2025-10-24 12:01:04'),
(4, '083306005200', '1day', '2025-10-25 09:05:50', '2025-10-24 09:05:49', '2025-10-24 09:05:49');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `activity_logs`
--
ALTER TABLE `activity_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_created` (`created_at`);

--
-- Indexes for table `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_status` (`payment_status`),
  ADD KEY `idx_created` (`created_at`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_reference` (`reference_number`),
  ADD KEY `idx_order_id` (`order_id`),
  ADD KEY `idx_transaction_date` (`transaction_date`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`);

--
-- Indexes for table `vip_subscriptions`
--
ALTER TABLE `vip_subscriptions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_expiry` (`expiry_date`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `activity_logs`
--
ALTER TABLE `activity_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `orders`
--
ALTER TABLE `orders`
  MODIFY `id` bigint(20) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `transactions`
--
ALTER TABLE `transactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `vip_subscriptions`
--
ALTER TABLE `vip_subscriptions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
