// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import { UniquePrecompiles } from "@unique-nft/contracts/UniquePrecompiles.sol";
import { UniqueFungible } from "@unique-nft/solidity-interfaces/contracts/UniqueFungible.sol";
import { CrossAddress } from "@unique-nft/solidity-interfaces/contracts/types.sol";

/**
 * @title VestingNative
 * @dev Vesting contract for native currency (UNQ) that supports both Ethereum and Substrate beneficiaries.
 * ALL AMOUNT IS AVAILABLE IMMEDIATELY AFTER THE VESTING PERIOD STARTS.
 */
contract VestingNative is Ownable, UniquePrecompiles {
    event Released(address indexed ethBeneficiary, uint256 indexed subBeneficiary, uint256 amount);
    event BatchAddBenefitiaries(address indexed ethBeneficiary, uint256 indexed subBeneficiary);
    event Donated(CrossAddress indexed donor, uint256 amount);
    event DonationRefunded(CrossAddress indexed donor, uint256 amount);

    mapping(bytes32 => uint256) private _released;
    mapping(bytes32 => uint256) private _allocated;
    mapping(bytes32 => uint256) private _donated;
    uint256 public donatedTotal;
    uint256 public releasedTotal;
    uint64 private immutable _start;
    uint64 private immutable _duration;

    UniqueFungible private immutable UNQ;

    constructor(uint64 startTimestamp, uint64 durationSeconds) payable Ownable(msg.sender) {
        require(startTimestamp > block.timestamp, "Start timestamp must be in the future");
        require(durationSeconds > 0, "Duration must be positive");
        
        _start = startTimestamp;
        _duration = durationSeconds;

        // Get the UNQ token contract instance from precompiles
        UNQ = UniqueFungible(COLLECTION_HELPERS.collectionAddress(0));
    }

    function crossKey(CrossAddress memory c) internal pure returns (bytes32) {
        return keccak256(abi.encode(c.eth, c.sub));
    }

    function batchAddBenefitiaries(
        CrossAddress[] calldata beneficiaries,
        uint256[] calldata allocatedAmounts
    ) external onlyOwner {
        require(beneficiaries.length == allocatedAmounts.length, "Arrays length mismatch");
        require(beneficiaries.length > 0, "Empty beneficiaries array");
        
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            CrossAddress calldata beneficiary = beneficiaries[i];
            bool isEth = beneficiary.sub == 0;
            
            require(isEth ? beneficiary.eth != address(0) : beneficiary.sub != 0, "Invalid beneficiary address");
            require(allocatedAmounts[i] > 0, "Allocation must be positive");

            require(_allocated[crossKey(beneficiary)] == 0, "Beneficiary already has allocation");
        }
        
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            CrossAddress calldata beneficiary = beneficiaries[i];
            _allocated[crossKey(beneficiary)] = allocatedAmounts[i];
            emit BatchAddBenefitiaries(beneficiary.eth, beneficiary.sub);
        }
    }
    
    // --- Getters ---

    function start() public view returns (uint256) { return _start; }
    function duration() public view returns (uint256) { return _duration; }
    function end() public view returns (uint256) { return start() + duration(); }
    function donated(CrossAddress calldata donor) public view returns (uint256) { return _donated[crossKey(donor)]; }

    function allocatedAmount(CrossAddress calldata beneficiary) external view returns (uint256) {
        return _allocated[crossKey(beneficiary)];
    }
    
    function released(CrossAddress memory beneficiary) public view returns (uint256) {
        return _released[crossKey(beneficiary)];
    }

    function vestedAmount(CrossAddress memory beneficiary, uint64 timestamp) public view returns (uint256) {
        uint256 totalAllocation = _allocated[crossKey(beneficiary)];
        return _vestingSchedule(totalAllocation, timestamp);
    }

    function releasable(CrossAddress memory beneficiary) public view returns (uint256) {
        uint256 vested = vestedAmount(beneficiary, uint64(block.timestamp));
        uint256 alreadyReleased = released(beneficiary);
        return vested > alreadyReleased ? vested - alreadyReleased : 0;
    }

    // --- Core Logic ---
    function release(CrossAddress memory beneficiary) public {
        bool isEth = beneficiary.sub == 0;
        if (!isEth)
            require(beneficiary.sub >> 12 * 8 == uint256(uint160(msg.sender)), "Caller is not the beneficiary");
        else
            require(beneficiary.eth == msg.sender, "Caller is not the beneficiary");
        uint256 amount = releasable(beneficiary);
        require(amount > 0, "Nothing to release");
        require(donatedTotal - releasedTotal >= amount, "Insufficient donated funds");

        _released[crossKey(beneficiary)] += amount;
        releasedTotal += amount;
        
        emit Released(beneficiary.eth, beneficiary.sub, amount);
        
        (bool success) = UNQ.transferCross(beneficiary, amount);
        require(success, "Native currency transfer failed");
    }

    // --- Donations and Refunds (for ETH addresses only) ---

    //TODO: should I remove that?
    receive() external payable onlyOwner {}

    function donate(CrossAddress memory donor) public payable {
        bool isEth = donor.sub == 0;
        if (!isEth)
            require(donor.sub >> 12 * 8 == uint256(uint160(msg.sender)), "Caller is not the donor");
        else
            require(donor.eth == msg.sender, "Caller is not the donor");
        require(msg.value > 0, "Amount must be positive");
        _donated[crossKey(donor)] += msg.value;
        donatedTotal += msg.value;
        emit Donated(donor, msg.value);
    }
    
    function refundDonation(CrossAddress memory donor, uint256 amount) public {
        bool isEth = donor.sub == 0;
        if (!isEth)
            require(donor.sub >> 12 * 8 == uint256(uint160(msg.sender)), "Caller is not the donor");
        else
            require(donor.eth == msg.sender, "Caller is not the donor");
        require(amount > 0, "Amount must be positive");
        require(_donated[crossKey(donor)] >= amount, "Amount exceeds donation");

        uint256 availableForRefund = donatedTotal - releasedTotal;
        require(availableForRefund >= amount, "Insufficient funds for refund");
        
        _donated[crossKey(donor)] -= amount;
        donatedTotal -= amount;
        
        emit DonationRefunded(donor, amount);

        (bool success) = UNQ.transferCross(donor, amount);
        require(success, "Native currency refund failed");
    }

    // --- Vesting Schedule ---
    function _vestingSchedule(uint256 totalAllocation, uint64 timestamp) internal view returns (uint256) {
        if (timestamp < start()) {
            return 0; // Nothing before start
        } else if (timestamp >= end()) {
            return 0; // Nothing after end
        } else {
            return totalAllocation; // Full amount after start
        }
    }
    
    // --- Utility ---
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    function emergencyWithdraw() external onlyOwner {
        require(releasedTotal == 0, "Cannot withdraw after releases started");
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance to withdraw");
        donatedTotal = 0;
        (bool success, ) = owner().call{value: balance}("");
        require(success, "Withdrawal failed");
    }
}